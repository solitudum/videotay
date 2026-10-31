use super::{ClipSpec, Codec, ExportSpec, Format};

/// How the video encoder should spend bits on one run.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Rate {
    Quality,
    Bitrate { kbps: u32, pass: Option<u8> },
}

/// File the two-pass encoders write to. It's relative because x265's option
/// syntax can't hold a Windows drive colon, so ffmpeg runs from a temp folder.
pub const PASS_LOG: &str = "videotay-pass";

fn even(value: f64) -> u32 {
    ((value.round() as u32) & !1).max(2)
}

/// Converts a normalized crop to even pixel values inside the source frame.
pub fn crop_pixels(clip: &ClipSpec) -> Option<(u32, u32, u32, u32)> {
    let crop = clip.crop?;
    let (sw, sh) = (clip.src_width, clip.src_height);
    let w = even(crop.w * sw as f64).min(sw & !1);
    let h = even(crop.h * sh as f64).min(sh & !1);
    let x = ((crop.x * sw as f64).round() as u32).min(sw - w);
    let y = ((crop.y * sh as f64).round() as u32).min(sh - h);
    Some((w, h, x, y))
}

fn video_chain(index: usize, clip: &ClipSpec, width: u32, height: u32, fps: f64) -> String {
    let mut steps = vec![format!("setpts=(PTS-STARTPTS)/{:.6}", clip.speed)];
    if let Some((w, h, x, y)) = crop_pixels(clip) {
        steps.push(format!("crop={w}:{h}:{x}:{y}"));
    }
    // Same order as the preview's CSS transform: flip first, then rotate.
    if clip.flip_h {
        steps.push("hflip".into());
    }
    if clip.flip_v {
        steps.push("vflip".into());
    }
    match clip.rotate {
        90 => steps.push("transpose=1".into()),
        180 => steps.push("hflip,vflip".into()),
        270 => steps.push("transpose=2".into()),
        _ => {}
    }
    steps.push(format!(
        "scale={width}:{height}:force_original_aspect_ratio=decrease:flags=lanczos"
    ));
    steps.push(format!("pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black"));
    steps.push("setsar=1".into());
    steps.push(format!("fps={fps:.3}"));
    format!("[{index}:v]{}[v{index}]", steps.join(","))
}

/// atempo takes 0.5 to 100 per filter, so slower speeds need a chain.
fn atempo(speed: f64) -> Vec<String> {
    let mut remaining = speed;
    let mut filters = Vec::new();
    while remaining < 0.5 {
        filters.push("atempo=0.5".to_string());
        remaining /= 0.5;
    }
    if (remaining - 1.0).abs() > 1e-6 {
        filters.push(format!("atempo={remaining:.6}"));
    }
    filters
}

fn audio_chain(index: usize, clip: &ClipSpec) -> String {
    let duration = clip.duration();
    if !clip.has_audio || clip.muted {
        return format!(
            "anullsrc=channel_layout=stereo:sample_rate=48000,atrim=0:{duration:.6},asetpts=PTS-STARTPTS[a{index}]"
        );
    }
    let mut steps = vec!["asetpts=PTS-STARTPTS".to_string()];
    steps.extend(atempo(clip.speed));
    if (clip.volume - 1.0).abs() > 1e-6 {
        steps.push(format!("volume={:.3}", clip.volume));
    }
    steps.push("aresample=48000".into());
    steps.push("aformat=channel_layouts=stereo:sample_fmts=fltp".into());
    steps.push(format!("atrim=0:{duration:.6}"));
    steps.push("asetpts=PTS-STARTPTS".into());
    format!("[{index}:a]{}[a{index}]", steps.join(","))
}

fn input_args(spec: &ExportSpec) -> Vec<String> {
    let mut args = Vec::new();
    for clip in &spec.clips {
        args.extend([
            "-ss".to_string(),
            format!("{:.6}", clip.in_s),
            "-t".to_string(),
            format!("{:.6}", clip.out_s - clip.in_s),
            "-i".to_string(),
            clip.path.clone(),
        ]);
    }
    args
}

fn video_encoder_args(spec: &ExportSpec, rate: Rate) -> Vec<String> {
    let s = |v: &[&str]| v.iter().map(|a| a.to_string()).collect::<Vec<_>>();
    let crf = spec.crf.to_string();

    // Hardware encoders are only used for quality mode; max MB needs the
    // reliable sizing of the software encoders.
    if let (Rate::Quality, Some(encoder)) = (rate, spec.hardware.as_deref()) {
        let mut args = s(&["-c:v", encoder]);
        if encoder.ends_with("videotoolbox") {
            let quality = (100 - (spec.crf.min(51) * 100 / 51)).max(1).to_string();
            args.extend(s(&["-q:v", &quality]));
        } else if encoder.ends_with("nvenc") {
            args.extend(s(&["-rc", "vbr", "-cq", &crf, "-b:v", "0"]));
        } else if encoder.ends_with("qsv") {
            args.extend(s(&["-global_quality", &crf]));
        } else {
            args.extend(s(&["-rc", "cqp", "-qp_i", &crf, "-qp_p", &crf]));
        }
        if encoder.starts_with("hevc") {
            args.extend(s(&["-tag:v", "hvc1"]));
        }
        return args;
    }

    let mut args = match spec.codec {
        Codec::H264 => s(&["-c:v", "libx264", "-preset", "medium"]),
        Codec::H265 => s(&["-c:v", "libx265", "-preset", "medium", "-tag:v", "hvc1"]),
        Codec::Av1 => s(&["-c:v", "libsvtav1", "-preset", "8"]),
        Codec::Vp9 => s(&["-c:v", "libvpx-vp9", "-row-mt", "1", "-cpu-used", "2"]),
    };
    match rate {
        Rate::Quality => {
            args.extend(s(&["-crf", &crf]));
            if spec.codec == Codec::Vp9 {
                args.extend(s(&["-b:v", "0"]));
            }
            if spec.codec == Codec::H265 {
                args.extend(s(&["-x265-params", "log-level=error"]));
            }
        }
        Rate::Bitrate { kbps, pass } => {
            args.extend(s(&["-b:v", &format!("{kbps}k")]));
            match (spec.codec, pass) {
                (Codec::H265, Some(pass)) => args.extend(s(&[
                    "-x265-params",
                    &format!("log-level=error:pass={pass}:stats={PASS_LOG}.log"),
                ])),
                (Codec::H265, None) => args.extend(s(&["-x265-params", "log-level=error"])),
                (_, Some(pass)) => args.extend(s(&[
                    "-pass:v",
                    &pass.to_string(),
                    "-passlogfile:v",
                    PASS_LOG,
                ])),
                _ => {}
            }
        }
    }
    args.extend(s(&["-pix_fmt", "yuv420p"]));
    args
}

fn audio_encoder_args(spec: &ExportSpec) -> Vec<String> {
    let kbps = spec.audio_kbps.unwrap_or(128);
    let codec = if spec.format == Format::Webm { "libopus" } else { "aac" };
    vec![
        "-c:a".into(),
        codec.into(),
        "-b:a".into(),
        format!("{kbps}k"),
        "-ac".into(),
        "2".into(),
    ]
}

/// Builds the arguments for a video export. A first pass discards its output
/// and only writes rate statistics.
pub fn video_args(spec: &ExportSpec, rate: Rate, output: &str) -> Vec<String> {
    let first_pass = matches!(rate, Rate::Bitrate { pass: Some(1), .. });
    let audio = spec.wants_audio() && !first_pass;
    let mut chains = Vec::new();
    let mut labels = String::new();
    for (i, clip) in spec.clips.iter().enumerate() {
        chains.push(video_chain(i, clip, spec.width, spec.height, spec.fps));
        labels.push_str(&format!("[v{i}]"));
        if audio {
            chains.push(audio_chain(i, clip));
            labels.push_str(&format!("[a{i}]"));
        }
    }
    let n = spec.clips.len();
    let a = u8::from(audio);
    let out_labels = if audio { "[v][a]" } else { "[v]" };
    chains.push(format!("{labels}concat=n={n}:v=1:a={a}{out_labels}"));

    let mut args = input_args(spec);
    args.extend(["-filter_complex".to_string(), chains.join(";"), "-map".into(), "[v]".into()]);
    if audio {
        args.extend(["-map".into(), "[a]".into()]);
        args.extend(audio_encoder_args(spec));
    } else {
        args.push("-an".into());
    }
    args.extend(video_encoder_args(spec, rate));
    args.extend(["-map_metadata".into(), "-1".into()]);

    if first_pass {
        args.extend(["-f".into(), "null".into(), "-".into()]);
    } else {
        match spec.format {
            Format::Webm => args.extend(["-f".into(), "webm".into()]),
            _ => args.extend([
                "-movflags".into(),
                "+faststart".into(),
                "-f".into(),
                "mp4".into(),
            ]),
        }
        args.push(output.to_string());
    }
    args
}

/// Builds the arguments for a GIF at a given width. Height follows the canvas
/// aspect ratio, and palette generation runs over the whole timeline.
pub fn gif_args(spec: &ExportSpec, width: u32, output: &str) -> Vec<String> {
    let height = gif_height(spec, width);
    let mut chains = Vec::new();
    let mut labels = String::new();
    for (i, clip) in spec.clips.iter().enumerate() {
        chains.push(video_chain(i, clip, width, height, spec.fps));
        labels.push_str(&format!("[v{i}]"));
    }
    let n = spec.clips.len();
    chains.push(format!("{labels}concat=n={n}:v=1:a=0[v]"));
    chains.push(format!(
        "[v]split[a][b];[a]palettegen=max_colors={}:stats_mode=diff[p];[b][p]paletteuse=dither={}:diff_mode=rectangle[out]",
        spec.gif.colors.clamp(2, 256),
        spec.gif.dither
    ));

    let mut args = input_args(spec);
    args.extend([
        "-filter_complex".to_string(),
        chains.join(";"),
        "-map".into(),
        "[out]".into(),
        "-loop".into(),
        if spec.gif.loop_forever { "0".into() } else { "-1".into() },
        "-map_metadata".into(),
        "-1".into(),
        "-f".into(),
        "gif".into(),
        output.to_string(),
    ]);
    args
}

pub fn gif_height(spec: &ExportSpec, width: u32) -> u32 {
    even(width as f64 * spec.height as f64 / spec.width as f64)
}

#[cfg(test)]
mod tests {
    use super::super::{Crop, GifOptions};
    use super::*;

    fn clip() -> ClipSpec {
        ClipSpec {
            path: "/a.mp4".into(),
            in_s: 1.0,
            out_s: 3.0,
            speed: 1.0,
            crop: None,
            rotate: 0,
            flip_h: false,
            flip_v: false,
            volume: 1.0,
            muted: false,
            src_width: 1920,
            src_height: 1080,
            has_audio: true,
        }
    }

    fn spec(clips: Vec<ClipSpec>) -> ExportSpec {
        ExportSpec {
            clips,
            output: "/out.mp4".into(),
            format: Format::Mp4,
            codec: Codec::H264,
            width: 1280,
            height: 720,
            fps: 30.0,
            crf: 23,
            max_mb: None,
            audio_kbps: Some(128),
            hardware: None,
            gif: GifOptions { colors: 128, dither: "bayer".into(), loop_forever: true },
        }
    }

    fn filter(args: &[String]) -> &str {
        let at = args.iter().position(|a| a == "-filter_complex").unwrap();
        &args[at + 1]
    }

    #[test]
    fn crop_is_even_and_stays_inside_the_frame() {
        let mut c = clip();
        c.crop = Some(Crop { x: 0.9, y: 0.9, w: 0.5, h: 0.333 });
        let (w, h, x, y) = crop_pixels(&c).unwrap();
        assert_eq!((w % 2, h % 2), (0, 0));
        assert!(x + w <= 1920 && y + h <= 1080);
    }

    #[test]
    fn flips_come_before_rotation_like_the_preview() {
        let mut c = clip();
        c.flip_h = true;
        c.rotate = 90;
        let chain = video_chain(0, &c, 1280, 720, 30.0);
        assert!(chain.find("hflip").unwrap() < chain.find("transpose=1").unwrap());
    }

    #[test]
    fn slow_speeds_chain_atempo_within_its_range() {
        assert_eq!(atempo(0.25), vec!["atempo=0.5", "atempo=0.500000"]);
        assert_eq!(atempo(1.0), Vec::<String>::new());
        assert_eq!(atempo(2.0), vec!["atempo=2.000000"]);
    }

    #[test]
    fn silent_and_muted_clips_get_generated_silence() {
        let mut silent = clip();
        silent.has_audio = false;
        let mut muted = clip();
        muted.muted = true;
        let args = video_args(&spec(vec![clip(), silent, muted]), Rate::Quality, "o.mp4");
        let graph = filter(&args);
        assert!(graph.contains("[0:a]"));
        assert_eq!(graph.matches("anullsrc").count(), 2);
        assert!(graph.contains("concat=n=3:v=1:a=1"));
    }

    #[test]
    fn audio_is_dropped_when_no_clip_makes_sound() {
        let mut muted = clip();
        muted.muted = true;
        let args = video_args(&spec(vec![muted]), Rate::Quality, "o.mp4");
        assert!(args.contains(&"-an".to_string()));
        assert!(filter(&args).contains("a=0"));
    }

    #[test]
    fn first_pass_writes_no_file_and_no_audio() {
        let rate = Rate::Bitrate { kbps: 900, pass: Some(1) };
        let args = video_args(&spec(vec![clip()]), rate, "o.mp4");
        assert_eq!(args.last().unwrap(), "-");
        assert!(args.contains(&"-an".to_string()));
        assert!(args.contains(&"-passlogfile:v".to_string()));
    }

    #[test]
    fn hardware_is_ignored_for_bitrate_targets() {
        let mut s = spec(vec![clip()]);
        s.hardware = Some("h264_videotoolbox".into());
        let quality = video_args(&s, Rate::Quality, "o.mp4");
        assert!(quality.contains(&"h264_videotoolbox".to_string()));
        let target = video_args(&s, Rate::Bitrate { kbps: 900, pass: Some(2) }, "o.mp4");
        assert!(target.contains(&"libx264".to_string()));
    }

    #[test]
    fn gif_uses_a_palette_and_drops_audio() {
        let mut s = spec(vec![clip()]);
        s.format = Format::Gif;
        let args = gif_args(&s, 480, "o.gif");
        let graph = filter(&args);
        assert!(graph.contains("palettegen=max_colors=128"));
        assert!(graph.contains("scale=480:270"));
        assert!(!graph.contains("[0:a]"));
    }
}
