use crate::tools::command;
use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::io::Read;
use std::path::Path;
use std::process::Stdio;
use std::thread;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeInfo {
    pub duration: f64,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub codec: String,
    pub has_audio: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Thumbs {
    pub paths: Vec<String>,
    pub interval: f64,
}

/// Waveform peaks per second of source audio.
pub const WAVEFORM_RATE: f64 = 20.0;

fn parse_rate(rate: &str) -> Option<f64> {
    let (num, den) = rate.split_once('/')?;
    let (num, den): (f64, f64) = (num.parse().ok()?, den.parse().ok()?);
    (den > 0.0 && num > 0.0).then_some(num / den)
}

fn number(value: &Value) -> Option<f64> {
    value.as_f64().or_else(|| value.as_str()?.parse().ok())
}

/// Reads display rotation from either modern side data or older stream tags.
fn rotation(stream: &Value) -> i64 {
    let side = stream["side_data_list"]
        .as_array()
        .and_then(|list| list.iter().find_map(|d| number(&d["rotation"])));
    let degrees = side.or_else(|| number(&stream["tags"]["rotate"])).unwrap_or(0.0);
    (degrees.round() as i64).rem_euclid(360)
}

pub fn parse_probe(json: &str) -> Result<ProbeInfo, String> {
    let root: Value = serde_json::from_str(json).map_err(|e| e.to_string())?;
    let streams = root["streams"].as_array().cloned().unwrap_or_default();
    let video = streams
        .iter()
        .find(|s| s["codec_type"] == "video" && s["disposition"]["attached_pic"] != 1)
        .ok_or("No video stream found")?;

    let mut width = video["width"].as_u64().unwrap_or(0) as u32;
    let mut height = video["height"].as_u64().unwrap_or(0) as u32;
    // ffmpeg and the webview both apply rotation when decoding, so every
    // coordinate in the app is in display space.
    if matches!(rotation(video), 90 | 270) {
        std::mem::swap(&mut width, &mut height);
    }

    let duration = number(&root["format"]["duration"])
        .or_else(|| number(&video["duration"]))
        .unwrap_or(0.0);
    if duration <= 0.0 || width == 0 || height == 0 {
        return Err("Could not read this video's duration or size".into());
    }

    let fps = video["avg_frame_rate"]
        .as_str()
        .and_then(parse_rate)
        .or_else(|| video["r_frame_rate"].as_str().and_then(parse_rate))
        .unwrap_or(30.0);

    Ok(ProbeInfo {
        duration,
        width,
        height,
        fps,
        codec: video["codec_name"].as_str().unwrap_or("unknown").to_string(),
        has_audio: streams.iter().any(|s| s["codec_type"] == "audio"),
    })
}

pub fn probe(path: &str) -> Result<ProbeInfo, String> {
    let output = command("ffprobe")
        .args(["-v", "error", "-print_format", "json", "-show_streams", "-show_format"])
        .arg(path)
        .output()
        .map_err(|e| format!("Could not run ffprobe: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "This file can't be read: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    parse_probe(&String::from_utf8_lossy(&output.stdout))
}

pub fn thumbnails(path: &str, duration: f64, dir: &Path) -> Result<Thumbs, String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let count = ((duration / 2.0).ceil() as usize).clamp(6, 60);
    let interval = duration / count as f64;
    let jobs: Vec<(f64, String)> = (0..count)
        .map(|i| {
            let time = (i as f64 + 0.5) * interval;
            (time, dir.join(format!("{i:03}.jpg")).to_string_lossy().into_owned())
        })
        .collect();

    thread::scope(|scope| {
        for chunk in jobs.chunks(jobs.len().div_ceil(4)) {
            scope.spawn(move || {
                for (time, out) in chunk {
                    let _ = command("ffmpeg")
                        .args(["-hide_banner", "-loglevel", "error", "-y", "-ss"])
                        .arg(format!("{time:.3}"))
                        .arg("-i")
                        .arg(path)
                        .args(["-frames:v", "1", "-vf", "scale=-2:96", "-q:v", "6"])
                        .arg(out)
                        .output();
                }
            });
        }
    });

    Ok(Thumbs {
        paths: jobs.into_iter().map(|(_, out)| out).collect(),
        interval,
    })
}

/// Returns peak levels from 0 to 1, or nothing if the file has no audio.
pub fn waveform(path: &str) -> Result<Vec<f32>, String> {
    const SAMPLE_RATE: f64 = 4000.0;
    let mut child = command("ffmpeg")
        .args(["-hide_banner", "-loglevel", "error", "-i"])
        .arg(path)
        .args(["-vn", "-ac", "1", "-ar", "4000", "-f", "f32le", "-"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;

    let bucket = (SAMPLE_RATE / WAVEFORM_RATE) as usize;
    let mut stdout = child.stdout.take().ok_or("No ffmpeg output")?;
    let mut bytes = vec![0u8; bucket * 4 * 64];
    let mut leftover = Vec::new();
    let mut peaks = Vec::new();
    let (mut peak, mut seen) = (0f32, 0usize);
    loop {
        let read = stdout.read(&mut bytes).map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        leftover.extend_from_slice(&bytes[..read]);
        let whole = leftover.len() / 4 * 4;
        for sample in leftover[..whole].chunks_exact(4) {
            let value = f32::from_le_bytes([sample[0], sample[1], sample[2], sample[3]]).abs();
            peak = peak.max(value);
            seen += 1;
            if seen == bucket {
                peaks.push(peak);
                peak = 0.0;
                seen = 0;
            }
        }
        leftover.drain(..whole);
    }
    if seen > 0 {
        peaks.push(peak);
    }
    let _ = child.wait();

    let max = peaks.iter().cloned().fold(0f32, f32::max);
    if max > 0.0 {
        peaks.iter_mut().for_each(|p| *p /= max);
    }
    Ok(peaks)
}

/// Makes an H.264 copy for sources the webview can't play. Only the preview
/// uses it; exports always read the original.
pub fn proxy(path: &str, out: &Path) -> Result<String, String> {
    if let Some(dir) = out.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let output = command("ffmpeg")
        .args(["-hide_banner", "-loglevel", "error", "-y", "-i"])
        .arg(path)
        .args([
            "-vf", "scale=-2:min(720\\,ih)", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset",
            "veryfast", "-crf", "26", "-g", "15", "-c:a", "aac", "-b:a", "128k", "-movflags",
            "+faststart",
        ])
        .arg(out)
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(out.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn swaps_dimensions_for_rotated_video() {
        let json = r#"{"format":{"duration":"3.5"},"streams":[
            {"codec_type":"video","codec_name":"h264","width":1920,"height":1080,
             "avg_frame_rate":"30000/1001","side_data_list":[{"rotation":-90}]},
            {"codec_type":"audio"}]}"#;
        let info = parse_probe(json).unwrap();
        assert_eq!((info.width, info.height), (1080, 1920));
        assert!((info.fps - 29.97).abs() < 0.01);
        assert!(info.has_audio);
    }

    #[test]
    fn ignores_cover_art_streams() {
        let json = r#"{"format":{"duration":"3"},"streams":[
            {"codec_type":"audio"},
            {"codec_type":"video","width":500,"height":500,"disposition":{"attached_pic":1}}]}"#;
        assert!(parse_probe(json).is_err());
    }
}
