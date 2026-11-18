using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace SpireRecolor;

public class ColorSwap
{
	[JsonPropertyName("from")] public string From { get; set; } = "#c03030";
	[JsonPropertyName("to")] public string To { get; set; } = "#3060d0";
	/// <summary>0..1 — how loosely "from" matches. Small = only that exact shade, large = the whole color family.</summary>
	[JsonPropertyName("range")] public float Range { get; set; } = 0.35f;
}

public class TargetRecolor
{
	[JsonPropertyName("enabled")] public bool Enabled { get; set; } = true;
	/// <summary>Degrees, -180..180.</summary>
	[JsonPropertyName("hue")] public float Hue { get; set; }
	[JsonPropertyName("saturation")] public float Saturation { get; set; } = 1f;
	[JsonPropertyName("brightness")] public float Brightness { get; set; } = 1f;
	[JsonPropertyName("contrast")] public float Contrast { get; set; } = 1f;
	[JsonPropertyName("tint")] public string Tint { get; set; } = "#ffffff";
	/// <summary>0..1 — 1 fully repaints the creature in the tint color (keeping its shading).</summary>
	[JsonPropertyName("tintStrength")] public float TintStrength { get; set; }
	[JsonPropertyName("swaps")] public List<ColorSwap> Swaps { get; set; } = new();

	/// <summary>A picture (file in textures/) laid over the colors like a texture. Null = none.</summary>
	[JsonPropertyName("picture")]
	[JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
	public string? Picture { get; set; }
	/// <summary>0..1 — how strongly the picture shows.</summary>
	[JsonPropertyName("pictureOpacity")] public float PictureOpacity { get; set; } = 0.6f;
	/// <summary>How the picture mixes in: "colors" (keeps the part's shading), "texture" (only its light/dark detail),
	/// "replace" (the picture exactly), "multiply" (darken), "screen" (lighten), "add" (glow).</summary>
	[JsonPropertyName("pictureMode")] public string PictureMode { get; set; } = "colors";
	/// <summary>How many times the picture repeats across the art (bigger = smaller pattern).</summary>
	[JsonPropertyName("pictureScale")] public float PictureScale { get; set; } = 4f;
	/// <summary>"art" = pinned to the art, bends with every animation; "flat" = laid flat over the body, stays straight.</summary>
	[JsonPropertyName("picturePlacement")] public string PicturePlacement { get; set; } = "art";
	/// <summary>-2..2: positive = wider, negative = taller (each step doubles).</summary>
	[JsonPropertyName("pictureStretch")] public float PictureStretch { get; set; }
	/// <summary>Moves the picture, in picture-widths / picture-heights.</summary>
	[JsonPropertyName("pictureOffsetX")] public float PictureOffsetX { get; set; }
	[JsonPropertyName("pictureOffsetY")] public float PictureOffsetY { get; set; }
	/// <summary>Degrees.</summary>
	[JsonPropertyName("pictureRotation")] public float PictureRotation { get; set; }
	[JsonPropertyName("pictureFlipX")] public bool PictureFlipX { get; set; }
	[JsonPropertyName("pictureFlipY")] public bool PictureFlipY { get; set; }
	/// <summary>False = one copy of the picture only (nothing around it).</summary>
	[JsonPropertyName("pictureRepeat")] public bool PictureRepeat { get; set; } = true;
	/// <summary>Sharp square pixels instead of smooth blending (for pixel art).</summary>
	[JsonPropertyName("picturePixelated")] public bool PicturePixelated { get; set; }
	/// <summary>The picture's own colors: hue shift in degrees, saturation and brightness multipliers.</summary>
	[JsonPropertyName("pictureHue")] public float PictureHue { get; set; }
	[JsonPropertyName("pictureSaturation")] public float PictureSaturation { get; set; } = 1f;
	[JsonPropertyName("pictureBrightness")] public float PictureBrightness { get; set; } = 1f;

	/// <summary>Everything about how the picture sits and looks, back to the defaults (keeps the picture and opacity).</summary>
	public void ResetPictureLayout()
	{
		var d = new TargetRecolor();
		PictureMode = d.PictureMode; PictureScale = d.PictureScale; PicturePlacement = d.PicturePlacement;
		PictureStretch = 0; PictureOffsetX = 0; PictureOffsetY = 0; PictureRotation = 0;
		PictureFlipX = false; PictureFlipY = false; PictureRepeat = true; PicturePixelated = false;
		PictureHue = 0; PictureSaturation = 1; PictureBrightness = 1;
	}

	[JsonIgnore] public bool HasPicture => !string.IsNullOrWhiteSpace(Picture) && PictureOpacity > 0.001f;

	/// <summary>Wear another creature's current look instead of its own (Osty → "necrobinder"). Null = own look.</summary>
	[JsonPropertyName("follow")]
	[JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
	public string? Follow { get; set; }

	/// <summary>Characters only: use the repainted part PNGs from models/&lt;character&gt;/.</summary>
	[JsonPropertyName("customModel")] public bool CustomModel { get; set; } = true;

	/// <summary>
	/// Per-part overrides, keyed by the skeleton's slot name (e.g. "helmet", "sword"). A part with an entry here
	/// uses its own settings instead of the whole-body ones. Only used on the top-level target.
	/// </summary>
	[JsonPropertyName("parts")]
	[JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
	public Dictionary<string, TargetRecolor>? Parts { get; set; }

	public bool HasParts => Parts is { Count: > 0 };

	/// <summary>True when this changes nothing. On the top-level target, Enabled=false switches off body and parts alike.</summary>
	public bool IsIdentity => !Enabled || (LookIsIdentity && !HasParts && string.IsNullOrEmpty(Follow));

	public bool LookIsIdentity =>
		Math.Abs(Hue) < 0.01f && Math.Abs(Saturation - 1f) < 0.001f && Math.Abs(Brightness - 1f) < 0.001f
		&& Math.Abs(Contrast - 1f) < 0.001f && TintStrength < 0.001f && Swaps.Count == 0 && !HasPicture;

	/// <summary>Copy of the look settings (no parts) — a new part starts out matching the whole body.</summary>
	public TargetRecolor CloneLook() => new()
	{
		Enabled = Enabled, Hue = Hue, Saturation = Saturation, Brightness = Brightness, Contrast = Contrast,
		Tint = Tint, TintStrength = TintStrength,
		Picture = Picture, PictureOpacity = PictureOpacity, PictureMode = PictureMode, PictureScale = PictureScale,
		PicturePlacement = PicturePlacement, PictureStretch = PictureStretch, PictureOffsetX = PictureOffsetX,
		PictureOffsetY = PictureOffsetY, PictureRotation = PictureRotation, PictureFlipX = PictureFlipX,
		PictureFlipY = PictureFlipY, PictureRepeat = PictureRepeat, PicturePixelated = PicturePixelated,
		PictureHue = PictureHue, PictureSaturation = PictureSaturation, PictureBrightness = PictureBrightness,
		Swaps = Swaps.ConvertAll(s => new ColorSwap { From = s.From, To = s.To, Range = s.Range })
	};
}

public class PaletteFile
{
	// Not "version": the game's mod loader reads every .json in the mod folder as a possible manifest.
	[JsonPropertyName("paletteFormat")] public int Version { get; set; } = 1;
	/// <summary>Key = lowercase game model id, e.g. "ironclad", "ceremonial_beast".</summary>
	[JsonPropertyName("targets")] public Dictionary<string, TargetRecolor> Targets { get; set; } = new();
}

public static class Palette
{
	public const string ShareCodePrefix = "SPIRERC1:";
	private static readonly JsonSerializerOptions JsonOpts = new() { WriteIndented = true };

	public static PaletteFile Current { get; private set; } = new();
	public static string FilePath { get; private set; } = "";

	/// <summary>Bumped on every edit so live creatures know to refresh.</summary>
	public static int Revision { get; private set; }

	public static void Init(string modDir)
	{
		FilePath = Path.Combine(modDir, "palette.json");
		Load();
		Backup("game start");
	}

	/// <summary>
	/// A dated copy of palette.json in backups/ (Joseph, 2026-09-27: "the share code overwrote all my characters").
	/// Made at every game start and before every share-code import. Always a new file; keeps the newest 40.
	/// </summary>
	public static string? Backup(string reason)
	{
		try
		{
			if (!File.Exists(FilePath)) return null;
			string dir = Path.Combine(Path.GetDirectoryName(FilePath)!, "backups");
			Directory.CreateDirectory(dir);
			string stamp = DateTime.Now.ToString("yyyy-MM-dd_HH-mm-ss");
			string name = $"palette_{stamp}_{reason.Replace(' ', '-')}.rcbackup";
			string path = Path.Combine(dir, name);
			for (int i = 2; File.Exists(path); i++) path = Path.Combine(dir, $"palette_{stamp}_{reason.Replace(' ', '-')}_{i}.rcbackup");
			File.Copy(FilePath, path);
			var old = new DirectoryInfo(dir).GetFiles("palette_*.rcbackup").OrderByDescending(f => f.CreationTimeUtc).Skip(40);
			foreach (var f in old) f.Delete();
			return path;
		}
		catch (Exception ex)
		{
			ModEntry.Log($"Palette backup failed: {ex.Message}");
			return null;
		}
	}

	public static void Load()
	{
		try
		{
			if (File.Exists(FilePath))
			{
				Current = JsonSerializer.Deserialize<PaletteFile>(File.ReadAllText(FilePath), JsonOpts) ?? new PaletteFile();
				ModEntry.Log($"Loaded palette with {Current.Targets.Count} recolored target(s) from {FilePath}");
			}
			else
			{
				Current = new PaletteFile();
				Save();
			}
		}
		catch (Exception ex)
		{
			ModEntry.Log($"Palette file could not be read, starting fresh: {ex.Message}");
			Current = new PaletteFile();
		}
		Revision++;
	}

	public static void Save()
	{
		try
		{
			File.WriteAllText(FilePath, JsonSerializer.Serialize(Current, JsonOpts));
		}
		catch (Exception ex)
		{
			ModEntry.Log($"Palette save failed: {ex.Message}");
		}
	}

	public static TargetRecolor? Get(string key) =>
		Current.Targets.TryGetValue(key, out var t) ? t : null;

	public static TargetRecolor GetOrCreate(string key)
	{
		if (!Current.Targets.TryGetValue(key, out var t))
		{
			t = new TargetRecolor();
			Current.Targets[key] = t;
		}
		return t;
	}

	public static void Remove(string key)
	{
		Current.Targets.Remove(key);
		Touch();
	}

	public static void Touch() => Revision++;

	/// <summary>A share code for one creature (onlyKey, plus any `with` keys such as its pet), or for every recolored creature (null).</summary>
	public static string ExportShareCode(string? onlyKey = null, IEnumerable<string>? with = null)
	{
		var file = Current;
		if (onlyKey != null)
		{
			file = new PaletteFile();
			foreach (var k in new[] { onlyKey }.Concat(with ?? Enumerable.Empty<string>()))
				if (Current.Targets.TryGetValue(k, out var t)) file.Targets[k] = t;
		}
		byte[] json = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(file));
		using var ms = new MemoryStream();
		using (var gz = new GZipStream(ms, CompressionLevel.SmallestSize))
			gz.Write(json, 0, json.Length);
		return ShareCodePrefix + Convert.ToBase64String(ms.ToArray());
	}

	/// <summary>Reads a share code without changing anything.</summary>
	public static PaletteFile ReadShareCode(string code)
	{
		code = code.Trim();
		string body = code.StartsWith(ShareCodePrefix, StringComparison.Ordinal) ? code[ShareCodePrefix.Length..] : code;
		PaletteFile? incoming;
		if (body.TrimStart().StartsWith("{"))
			incoming = JsonSerializer.Deserialize<PaletteFile>(body, JsonOpts);
		else
		{
			using var input = new MemoryStream(Convert.FromBase64String(body));
			using var gz = new GZipStream(input, CompressionMode.Decompress);
			using var reader = new StreamReader(gz, Encoding.UTF8);
			incoming = JsonSerializer.Deserialize<PaletteFile>(reader.ReadToEnd(), JsonOpts);
		}
		return incoming ?? throw new InvalidDataException("empty share code");
	}

	/// <summary>Merges a share code into the current palette (targets in the code overwrite ours). Returns how many targets it carried.
	/// (Test hook "import" only; the editor imports one creature at a time.)</summary>
	public static int ImportShareCode(string code)
	{
		Backup("before import");
		code = code.Trim();
		string body = code.StartsWith(ShareCodePrefix, StringComparison.Ordinal) ? code[ShareCodePrefix.Length..] : code;
		PaletteFile? incoming;
		if (body.TrimStart().StartsWith("{"))
		{
			incoming = JsonSerializer.Deserialize<PaletteFile>(body, JsonOpts);
		}
		else
		{
			using var input = new MemoryStream(Convert.FromBase64String(body));
			using var gz = new GZipStream(input, CompressionMode.Decompress);
			using var reader = new StreamReader(gz, Encoding.UTF8);
			incoming = JsonSerializer.Deserialize<PaletteFile>(reader.ReadToEnd(), JsonOpts);
		}
		if (incoming == null)
			throw new InvalidDataException("empty share code");
		foreach (var kv in incoming.Targets)
			Current.Targets[kv.Key] = kv.Value;
		Touch();
		Save();
		return incoming.Targets.Count;
	}
}
