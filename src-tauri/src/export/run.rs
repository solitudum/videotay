use super::graph::{self, Rate};
use super::size::{self, GifSearch};
use super::{ExportError, ExportSpec, Format, Outcome, Progress};
use crate::tools::command;
use std::env;
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;

const MAX_RETRIES: u32 = 3;
const MAX_GIF_ENCODES: u32 = 5;

/// A running export that another thread can cancel.
#[derive(Default)]
pub struct Job {
    cancelled: AtomicBool,
    child: Mutex<Option<Child>>,
}

impl Job {
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        if let Some(child) = self.child.lock().unwrap().as_mut() {
            let _ = child.kill();
        }
    }

    fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }
}

/// Reads the encoded position from a `-progress` line, in seconds.
fn progress_seconds(line: &str) -> Option<f64> {
    let value = line.strip_prefix("out_time_us=")?;
    value.trim().parse::<f64>().ok().map(|us| us / 1_000_000.0)
}

struct Runner<'a> {
    job: &'a Job,
    workdir: PathBuf,
    duration: f64,
    report: &'a mut dyn FnMut(Progress),
}

impl Runner<'_> {
    fn ffmpeg(&mut self, args: &[String], stage: &str) -> Result<(), ExportError> {
        if self.job.is_cancelled() {
            return Err(ExportError::Cancelled);
        }
        (self.report)(Progress { stage: stage.into(), fraction: 0.0 });

        let mut child = command("ffmpeg")
            .args(["-hide_banner", "-nostdin", "-y", "-loglevel", "error", "-nostats"])
            .args(["-progress", "pipe:1"])
            .args(args)
            .current_dir(&self.workdir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| ExportError::Failed { message: format!("Could not run ffmpeg: {e}") })?;

        let stdout = child.stdout.take().expect("stdout is piped");
        let mut stderr = child.stderr.take().expect("stderr is piped");
        *self.job.child.lock().unwrap() = Some(child);
        if self.job.is_cancelled() {
            self.job.cancel();
        }

        let errors = thread::spawn(move || {
            let mut text = String::new();
            let _ = stderr.read_to_string(&mut text);
            text
        });
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Some(seconds) = progress_seconds(&line) {
                let fraction = (seconds / self.duration).clamp(0.0, 1.0);
                (self.report)(Progress { stage: stage.into(), fraction });
            }
        }

        let status = self.job.child.lock().unwrap().take().map(|mut c| c.wait());
        let errors = errors.join().unwrap_or_default();
        if self.job.is_cancelled() {
            return Err(ExportError::Cancelled);
        }
        match status {
            Some(Ok(status)) if status.success() => Ok(()),
            _ => {
                let tail: Vec<&str> = errors.lines().rev().take(6).collect();
                let message = tail.into_iter().rev().collect::<Vec<_>>().join("\n");
                Err(ExportError::Failed {
                    message: if message.is_empty() { "ffmpeg failed".into() } else { message },
                })
            }
        }
    }
}

fn file_size(path: &Path) -> Result<u64, ExportError> {
    fs::metadata(path)
        .map(|m| m.len())
        .map_err(|e| ExportError::Failed { message: format!("Export produced no file: {e}") })
}

fn sibling(output: &Path, tag: &str) -> PathBuf {
    let stem = output.file_stem().unwrap_or_default().to_string_lossy();
    let ext = output.extension().unwrap_or_default().to_string_lossy();
    output.with_file_name(format!("{stem}.videotay-{tag}.{ext}"))
}

fn publish(from: &Path, to: &Path) -> Result<(), ExportError> {
    fs::rename(from, to)
        .map_err(|e| ExportError::Failed { message: format!("Could not save the file: {e}") })
}

fn export_video(
    spec: &ExportSpec,
    runner: &mut Runner,
    output: &Path,
    part: &Path,
) -> Result<Outcome, ExportError> {
    let part_str = part.to_string_lossy().into_owned();
    let done = |bytes, attempts| Outcome {
        path: spec.output.clone(),
        bytes,
        attempts,
        width: spec.width,
        height: spec.height,
    };

    let Some(max_mb) = spec.max_mb else {
        let args = graph::video_args(spec, Rate::Quality, &part_str);
        runner.ffmpeg(&args, "Encoding")?;
        let bytes = file_size(part)?;
        publish(part, output)?;
        return Ok(done(bytes, 1));
    };

    let limit = size::limit_bytes(max_mb);
    let duration = spec.duration();
    let audio = if spec.wants_audio() { spec.audio_kbps } else { None };
    let two_pass = spec.codec != super::Codec::Av1;
    let mut kbps = size::initial_kbps(limit, audio, duration);
    let mut smallest = u64::MAX;

    for attempt in 0..=MAX_RETRIES {
        let label = if attempt == 0 { String::new() } else { format!(" (retry {attempt})") };
        // Stats from the first pass stay valid across retries of the second.
        if two_pass && attempt == 0 {
            let rate = Rate::Bitrate { kbps, pass: Some(1) };
            runner.ffmpeg(&graph::video_args(spec, rate, &part_str), "Analyzing")?;
        }
        let rate = Rate::Bitrate { kbps, pass: two_pass.then_some(2) };
        let stage = format!("Encoding{label}");
        runner.ffmpeg(&graph::video_args(spec, rate, &part_str), &stage)?;

        let bytes = file_size(part)?;
        if bytes <= limit {
            publish(part, output)?;
            return Ok(done(bytes, attempt + 1));
        }
        smallest = smallest.min(bytes);
        match size::next_kbps(kbps, bytes, limit, audio, duration) {
            Some(next) => kbps = next,
            None => break,
        }
    }
    Err(ExportError::TooSmall { smallest_bytes: smallest, limit_bytes: limit })
}

fn export_gif(
    spec: &ExportSpec,
    runner: &mut Runner,
    output: &Path,
    part: &Path,
) -> Result<Outcome, ExportError> {
    let part_str = part.to_string_lossy().into_owned();
    let done = |bytes, attempts, width| Outcome {
        path: spec.output.clone(),
        bytes,
        attempts,
        width,
        height: graph::gif_height(spec, width),
    };

    let Some(max_mb) = spec.max_mb else {
        runner.ffmpeg(&graph::gif_args(spec, spec.width, &part_str), "Encoding GIF")?;
        let bytes = file_size(part)?;
        publish(part, output)?;
        return Ok(done(bytes, 1, spec.width));
    };

    let limit = size::limit_bytes(max_mb);
    let best = sibling(output, "best");
    let mut search = GifSearch::default();
    let mut width = spec.width;
    let mut smallest = u64::MAX;
    let mut encodes = 0;

    let result = loop {
        encodes += 1;
        let stage = format!("Encoding GIF at {width}px");
        if let Err(e) = runner.ffmpeg(&graph::gif_args(spec, width, &part_str), &stage) {
            break Err(e);
        }
        let bytes = match file_size(part) {
            Ok(bytes) => bytes,
            Err(e) => break Err(e),
        };
        smallest = smallest.min(bytes);
        let improved = bytes <= limit && search.best_width().is_none_or(|w| width > w);
        search.record(width, bytes, limit);
        if improved {
            if let Err(e) = publish(part, &best) {
                break Err(e);
            }
        }
        match (encodes < MAX_GIF_ENCODES).then(|| search.next_width(limit)).flatten() {
            Some(next) => width = next,
            None => break Ok(()),
        }
    };

    if let Err(e) = result {
        let _ = fs::remove_file(&best);
        return Err(e);
    }
    match search.best_width() {
        Some(width) => {
            let bytes = file_size(&best)?;
            publish(&best, output)?;
            Ok(done(bytes, encodes, width))
        }
        None => Err(ExportError::TooSmall { smallest_bytes: smallest, limit_bytes: limit }),
    }
}

/// Runs an export to completion. Output only appears at its final path once it
/// meets the size limit; partial files never outlive this call.
pub fn export(
    spec: &ExportSpec,
    job: &Job,
    report: &mut dyn FnMut(Progress),
) -> Result<Outcome, ExportError> {
    if spec.clips.is_empty() {
        return Err(ExportError::Failed { message: "The timeline is empty".into() });
    }
    let output = PathBuf::from(&spec.output);
    let part = sibling(&output, "part");
    let id = format!("videotay-{}-{:p}", std::process::id(), job);
    let workdir = env::temp_dir().join(id);
    fs::create_dir_all(&workdir)
        .map_err(|e| ExportError::Failed { message: e.to_string() })?;

    let mut runner = Runner { job, workdir: workdir.clone(), duration: spec.duration(), report };
    let result = match spec.format {
        Format::Gif => export_gif(spec, &mut runner, &output, &part),
        _ => export_video(spec, &mut runner, &output, &part),
    };

    let _ = fs::remove_file(&part);
    let _ = fs::remove_dir_all(&workdir);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_progress_lines() {
        assert_eq!(progress_seconds("out_time_us=2500000"), Some(2.5));
        assert_eq!(progress_seconds("out_time_us=N/A"), None);
        assert_eq!(progress_seconds("frame=12"), None);
    }

    #[test]
    fn sibling_keeps_the_extension() {
        let path = sibling(Path::new("/a/clip.final.mp4"), "part");
        assert_eq!(path, Path::new("/a/clip.final.videotay-part.mp4"));
    }
}
