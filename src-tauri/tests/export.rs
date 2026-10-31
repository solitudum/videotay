//! Real exports through ffmpeg, checked with ffprobe. Needs ffmpeg on PATH and
//! the clips from `scripts/make-test-clips`.

use std::path::PathBuf;
use std::process::Command;
use videotay_lib::export::run::{export, Job};
use videotay_lib::export::{ClipSpec, Codec, Crop, ExportError, ExportSpec, Format, GifOptions, Outcome};
use videotay_lib::media;

fn clip_path(name: &str) -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../public/dev-clips").join(name);
    assert!(path.exists(), "Run scripts/make-test-clips first: {path:?} is missing");
    path.to_string_lossy().into_owned()
}

fn clip(name: &str, in_s: f64, out_s: f64) -> ClipSpec {
    let path = clip_path(name);
    let info = media::probe(&path).unwrap();
    ClipSpec {
        path,
        in_s,
        out_s,
        speed: 1.0,
        crop: None,
        rotate: 0,
        flip_h: false,
        flip_v: false,
        volume: 1.0,
        muted: false,
        src_width: info.width,
        src_height: info.height,
        has_audio: info.has_audio,
    }
}

fn mixed_clips() -> Vec<ClipSpec> {
    vec![
        clip("landscape-720p30.mp4", 1.0, 3.0),
        clip("portrait-24fps.mp4", 0.5, 2.0),
        clip("square-60fps-silent.mp4", 1.0, 2.5),
    ]
}

fn spec(name: &str, format: Format, codec: Codec) -> ExportSpec {
    let dir = std::env::temp_dir().join("videotay-tests");
    std::fs::create_dir_all(&dir).unwrap();
    let ext = match format {
        Format::Mp4 => "mp4",
        Format::Webm => "webm",
        Format::Gif => "gif",
    };
    let output = dir.join(format!("{name}.{ext}"));
    let _ = std::fs::remove_file(&output);
    ExportSpec {
        clips: mixed_clips(),
        output: output.to_string_lossy().into_owned(),
        format,
        codec,
        width: 640,
        height: 360,
        fps: 30.0,
        crf: 30,
        max_mb: None,
        audio_kbps: Some(96),
        hardware: None,
        gif: GifOptions { colors: 128, dither: "bayer".into(), loop_forever: true },
    }
}

struct Probe {
    codec: String,
    width: u64,
    height: u64,
    duration: f64,
    has_audio: bool,
}

fn inspect(path: &str) -> Probe {
    let output = Command::new("ffprobe")
        .args(["-v", "error", "-print_format", "json", "-show_streams", "-show_format", path])
        .output()
        .unwrap();
    let root: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    let streams = root["streams"].as_array().unwrap();
    let video = streams.iter().find(|s| s["codec_type"] == "video").unwrap();
    Probe {
        codec: video["codec_name"].as_str().unwrap().to_string(),
        width: video["width"].as_u64().unwrap(),
        height: video["height"].as_u64().unwrap(),
        duration: root["format"]["duration"].as_str().unwrap().parse().unwrap(),
        has_audio: streams.iter().any(|s| s["codec_type"] == "audio"),
    }
}

fn run(spec: &ExportSpec) -> Result<Outcome, ExportError> {
    export(spec, &Job::default(), &mut |_| {})
}

fn assert_no_leftovers(spec: &ExportSpec) {
    let dir = PathBuf::from(&spec.output).parent().unwrap().to_path_buf();
    let stem = PathBuf::from(&spec.output).file_stem().unwrap().to_string_lossy().into_owned();
    for entry in std::fs::read_dir(dir).unwrap() {
        let name = entry.unwrap().file_name().to_string_lossy().into_owned();
        assert!(
            !name.starts_with(&format!("{stem}.videotay-")),
            "left behind {name}"
        );
    }
}

fn check_codec(name: &str, format: Format, codec: Codec, expected: &str) {
    let s = spec(name, format, codec);
    let outcome = run(&s).unwrap();
    let probe = inspect(&outcome.path);
    assert_eq!(probe.codec, expected);
    assert_eq!((probe.width, probe.height), (640, 360));
    assert!((probe.duration - 5.0).abs() < 0.25, "duration was {}", probe.duration);
    assert!(probe.has_audio);
    assert_no_leftovers(&s);
}

#[test]
fn mp4_h264() {
    check_codec("h264", Format::Mp4, Codec::H264, "h264");
}

#[test]
fn mp4_h265() {
    check_codec("h265", Format::Mp4, Codec::H265, "hevc");
}

#[test]
fn mp4_av1() {
    check_codec("av1", Format::Mp4, Codec::Av1, "av1");
}

#[test]
fn webm_vp9() {
    check_codec("vp9", Format::Webm, Codec::Vp9, "vp9");
}

#[test]
fn webm_av1() {
    check_codec("webm-av1", Format::Webm, Codec::Av1, "av1");
}

#[test]
fn gif_plain() {
    let s = spec("plain", Format::Gif, Codec::H264);
    let outcome = run(&s).unwrap();
    let probe = inspect(&outcome.path);
    assert_eq!(probe.codec, "gif");
    assert_eq!((probe.width, probe.height), (640, 360));
    assert!(!probe.has_audio);
}

#[test]
fn trim_speed_crop_and_rotate_reach_the_output() {
    let mut s = spec("edits", Format::Mp4, Codec::H264);
    let mut c = clip("landscape-720p30.mp4", 0.0, 4.0);
    c.speed = 2.0;
    c.crop = Some(Crop { x: 0.25, y: 0.0, w: 0.5, h: 1.0 });
    c.rotate = 90;
    c.flip_h = true;
    s.clips = vec![c];
    s.width = 720;
    s.height = 640;
    let outcome = run(&s).unwrap();
    let probe = inspect(&outcome.path);
    assert_eq!((probe.width, probe.height), (720, 640));
    assert!((probe.duration - 2.0).abs() < 0.15, "duration was {}", probe.duration);
}

#[test]
fn slow_motion_keeps_audio_in_sync() {
    let mut s = spec("slow", Format::Mp4, Codec::H264);
    let mut c = clip("landscape-720p30.mp4", 0.0, 1.0);
    c.speed = 0.25;
    s.clips = vec![c];
    let outcome = run(&s).unwrap();
    let probe = inspect(&outcome.path);
    assert!((probe.duration - 4.0).abs() < 0.2, "duration was {}", probe.duration);
    assert!(probe.has_audio);
}

fn check_limit(name: &str, format: Format, codec: Codec, mb: f64) {
    let mut s = spec(name, format, codec);
    s.clips = vec![clip("landscape-720p30.mp4", 0.0, 6.0)];
    s.width = 1280;
    s.height = 720;
    s.max_mb = Some(mb);
    let outcome = run(&s).unwrap();
    let limit = (mb * 1_000_000.0) as u64;
    assert!(outcome.bytes <= limit, "{} > {limit}", outcome.bytes);
    assert_eq!(std::fs::metadata(&outcome.path).unwrap().len(), outcome.bytes);
    assert_no_leftovers(&s);
}

#[test]
fn max_mb_h264() {
    check_limit("limit-h264", Format::Mp4, Codec::H264, 1.0);
}

#[test]
fn max_mb_h265() {
    check_limit("limit-h265", Format::Mp4, Codec::H265, 1.0);
}

#[test]
fn max_mb_av1() {
    check_limit("limit-av1", Format::Mp4, Codec::Av1, 1.0);
}

#[test]
fn max_mb_vp9() {
    check_limit("limit-vp9", Format::Webm, Codec::Vp9, 1.0);
}

#[test]
fn max_mb_ten() {
    check_limit("limit-ten", Format::Mp4, Codec::H264, 10.0);
}

#[test]
fn max_mb_gif_keeps_the_largest_width_that_fits() {
    let mut s = spec("limit-gif", Format::Gif, Codec::H264);
    s.clips = vec![clip("landscape-720p30.mp4", 0.0, 3.0)];
    s.width = 1280;
    s.height = 720;
    s.fps = 12.0;
    s.max_mb = Some(0.5);
    let outcome = run(&s).unwrap();
    assert!(outcome.bytes <= 500_000, "{}", outcome.bytes);
    assert!(outcome.width < 1280);
    assert_eq!(inspect(&outcome.path).width, outcome.width as u64);
    assert_no_leftovers(&s);
}

#[test]
fn impossible_limit_reports_and_keeps_no_file() {
    let mut s = spec("impossible", Format::Mp4, Codec::H264);
    s.clips = vec![clip("landscape-720p30.mp4", 0.0, 6.0)];
    s.max_mb = Some(0.001);
    match run(&s) {
        Err(ExportError::TooSmall { smallest_bytes, limit_bytes }) => {
            assert_eq!(limit_bytes, 1000);
            assert!(smallest_bytes > limit_bytes);
        }
        other => panic!("expected TooSmall, got {other:?}"),
    }
    assert!(!PathBuf::from(&s.output).exists());
    assert_no_leftovers(&s);
}

#[test]
fn impossible_gif_limit_reports_and_keeps_no_file() {
    let mut s = spec("impossible-gif", Format::Gif, Codec::H264);
    s.max_mb = Some(0.0001);
    assert!(matches!(run(&s), Err(ExportError::TooSmall { .. })));
    assert!(!PathBuf::from(&s.output).exists());
    assert_no_leftovers(&s);
}

#[test]
fn cancelling_stops_and_cleans_up() {
    let s = spec("cancel", Format::Mp4, Codec::Vp9);
    let job = Job::default();
    let result = std::thread::scope(|scope| {
        let handle = scope.spawn(|| export(&s, &job, &mut |_| {}));
        std::thread::sleep(std::time::Duration::from_millis(150));
        job.cancel();
        handle.join().unwrap()
    });
    assert!(matches!(result, Err(ExportError::Cancelled)));
    assert!(!PathBuf::from(&s.output).exists());
    assert_no_leftovers(&s);
}

#[test]
fn thumbnails_are_real_images() {
    let dir = std::env::temp_dir().join("videotay-tests/thumbs");
    let _ = std::fs::remove_dir_all(&dir);
    let thumbs = media::thumbnails(&clip_path("landscape-720p30.mp4"), 6.0, &dir).unwrap();
    assert_eq!(thumbs.paths.len(), 6);
    assert!((thumbs.interval - 1.0).abs() < 1e-9);
    for path in &thumbs.paths {
        assert!(std::fs::metadata(path).unwrap().len() > 0, "{path} is empty");
    }
}

#[test]
fn waveform_covers_the_audio_and_is_normalized() {
    let peaks = media::waveform(&clip_path("landscape-720p30.mp4")).unwrap();
    let expected = 6.0 * media::WAVEFORM_RATE;
    assert!((peaks.len() as f64 - expected).abs() <= 2.0, "{} peaks", peaks.len());
    let max = peaks.iter().cloned().fold(0f32, f32::max);
    assert!((max - 1.0).abs() < 1e-3);
}

#[test]
fn waveform_is_empty_without_audio() {
    assert!(media::waveform(&clip_path("square-60fps-silent.mp4")).unwrap().is_empty());
}

#[test]
fn proxy_is_h264_and_no_taller_than_720() {
    let out = std::env::temp_dir().join("videotay-tests/proxy/portrait.mp4");
    let path = media::proxy(&clip_path("portrait-24fps.mp4"), &out).unwrap();
    let probe = inspect(&path);
    assert_eq!(probe.codec, "h264");
    assert_eq!(probe.height, 720);
    assert_eq!(probe.width % 2, 0);
}

#[test]
fn probe_reads_a_real_file() {
    let info = media::probe(&clip_path("square-60fps-silent.mp4")).unwrap();
    assert_eq!((info.width, info.height), (640, 640));
    assert_eq!(info.fps.round(), 60.0);
    assert!(!info.has_audio);
}

#[test]
fn accepts_the_json_the_frontend_sends() {
    // Same shape as buildSpec in src/state/output.ts.
    let json = serde_json::json!({
        "clips": [{
            "path": "/a.mp4", "in": 1.5, "out": 3.0, "speed": 2, "crop": { "x": 0, "y": 0, "w": 0.5, "h": 1 },
            "rotate": 90, "flipH": true, "flipV": false, "volume": 0.5, "muted": false,
            "srcWidth": 1920, "srcHeight": 1080, "hasAudio": true
        }],
        "output": "/o.mp4", "format": "webm", "codec": "vp9", "width": 1280, "height": 720,
        "fps": 29.97, "crf": 33, "maxMb": null, "audioKbps": 128, "hardware": null,
        "gif": { "colors": 128, "dither": "sierra2_4a", "loop": true }
    });
    let spec: ExportSpec = serde_json::from_value(json).unwrap();
    assert_eq!(spec.format, Format::Webm);
    assert_eq!(spec.codec, Codec::Vp9);
    assert!(spec.clips[0].flip_h);
    assert_eq!(spec.clips[0].in_s, 1.5);
    assert!((spec.duration() - 0.75).abs() < 1e-9);
    assert!(spec.gif.loop_forever);
}

#[test]
fn sends_the_json_the_frontend_expects() {
    let too_small = ExportError::TooSmall { smallest_bytes: 5, limit_bytes: 1 };
    assert_eq!(
        serde_json::to_value(&too_small).unwrap(),
        serde_json::json!({ "kind": "tooSmall", "smallestBytes": 5, "limitBytes": 1 })
    );
    assert_eq!(
        serde_json::to_value(ExportError::Cancelled).unwrap(),
        serde_json::json!({ "kind": "cancelled" })
    );
    let failed = ExportError::Failed { message: "x".into() };
    assert_eq!(
        serde_json::to_value(&failed).unwrap(),
        serde_json::json!({ "kind": "failed", "message": "x" })
    );
}
