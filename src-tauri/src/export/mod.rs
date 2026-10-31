pub mod graph;
pub mod run;
pub mod size;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Deserialize)]
pub struct Crop {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipSpec {
    pub path: String,
    #[serde(rename = "in")]
    pub in_s: f64,
    #[serde(rename = "out")]
    pub out_s: f64,
    pub speed: f64,
    pub crop: Option<Crop>,
    pub rotate: u32,
    pub flip_h: bool,
    pub flip_v: bool,
    pub volume: f64,
    pub muted: bool,
    pub src_width: u32,
    pub src_height: u32,
    pub has_audio: bool,
}

impl ClipSpec {
    pub fn duration(&self) -> f64 {
        (self.out_s - self.in_s) / self.speed
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Format {
    Mp4,
    Webm,
    Gif,
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Codec {
    H264,
    H265,
    Av1,
    Vp9,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GifOptions {
    pub colors: u32,
    pub dither: String,
    #[serde(rename = "loop")]
    pub loop_forever: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSpec {
    pub clips: Vec<ClipSpec>,
    pub output: String,
    pub format: Format,
    pub codec: Codec,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub crf: u32,
    pub max_mb: Option<f64>,
    pub audio_kbps: Option<u32>,
    pub hardware: Option<String>,
    pub gif: GifOptions,
}

impl ExportSpec {
    pub fn duration(&self) -> f64 {
        self.clips.iter().map(ClipSpec::duration).sum()
    }

    /// Audio is dropped when it's turned off or when no clip would make a sound.
    pub fn wants_audio(&self) -> bool {
        self.format != Format::Gif
            && self.audio_kbps.is_some()
            && self.clips.iter().any(|c| c.has_audio && !c.muted)
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Outcome {
    pub path: String,
    pub bytes: u64,
    pub attempts: u32,
    /// Final dimensions, which a GIF size search may have reduced.
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ExportError {
    Cancelled,
    #[serde(rename_all = "camelCase")]
    TooSmall { smallest_bytes: u64, limit_bytes: u64 },
    Failed { message: String },
}

#[derive(Debug, Clone, Serialize)]
pub struct Progress {
    pub stage: String,
    pub fraction: f64,
}
