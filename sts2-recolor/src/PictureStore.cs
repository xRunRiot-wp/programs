using System;
using System.Collections.Generic;
using System.IO;
using Godot;

namespace SpireRecolor;

/// <summary>
/// Pictures used as "textures" on a creature or part (Joseph, 2026-09-27: "be able to add pictures to colors so they
/// act as texture (add opacity option and option for just texturing like physically)").
///
/// A chosen picture is copied into the mod's textures/ folder as a PNG (resized to at most 1024 px), so the palette
/// only stores its file name and share packs can carry it. Loaded textures are cached.
/// </summary>
internal static class PictureStore
{
	public const int MaxSize = 1024;
	/// <summary>Resolutions offered in the editor ("Picture resolution").</summary>
	public static readonly int[] Sizes = { 128, 256, 512, 1024, 2048, 4096 };
	/// <summary>Chosen resolution for newly added pictures.</summary>
	public static int ImportSize = MaxSize;
	private static readonly Dictionary<string, (long stamp, ImageTexture tex)> _cache = new();

	public static string Dir => Path.Combine(ModEntry.ModDir, "textures");

	private static string OriginalsDir => Path.Combine(Dir, "originals");

	/// <summary>Copy a picture into textures/ (at <see cref="ImportSize"/>) and return the name to store in the palette.
	/// A full-size copy (up to 4096 px) is kept in textures/originals/ so it can be re-sized later without blur.</summary>
	public static string Import(string sourcePath)
	{
		var img = Image.LoadFromFile(sourcePath);
		if (img == null || img.IsEmpty())
			throw new InvalidOperationException("That file isn't a picture Godot can read (use PNG, JPG or WEBP).");
		if (img.GetFormat() != Image.Format.Rgba8)
			img.Convert(Image.Format.Rgba8);
		Directory.CreateDirectory(Dir);
		string baseName = Sanitize(Path.GetFileNameWithoutExtension(sourcePath));
		string name = baseName + ".png";
		for (int i = 2; File.Exists(Path.Combine(Dir, name)) || File.Exists(Path.Combine(OriginalsDir, name)); i++)
			name = $"{baseName}_{i}.png";
		var orig = (Image)img.Duplicate();
		FitWithin(orig, 4096);
		Directory.CreateDirectory(OriginalsDir);
		orig.SavePng(Path.Combine(OriginalsDir, name));
		FitWithin(img, ImportSize);
		img.SavePng(Path.Combine(Dir, name));
		return name;
	}

	private static void FitWithin(Image img, int max)
	{
		int w = img.GetWidth(), h = img.GetHeight();
		if (Math.Max(w, h) <= max) return;
		float k = max / (float)Math.Max(w, h);
		img.Resize(Math.Max(1, (int)(w * k)), Math.Max(1, (int)(h * k)), Image.Interpolation.Lanczos);
	}

	/// <summary>Largest side of a stored picture in pixels (0 if missing).</summary>
	public static int PixelSize(string? name)
	{
		var t = Get(name);
		return t == null ? 0 : Math.Max(t.GetWidth(), t.GetHeight());
	}

	/// <summary>
	/// A copy of a stored picture at another resolution, as a NEW file "&lt;name&gt;_&lt;size&gt;px.png" (existing files are
	/// never overwritten). Made from the full-size original when there is one, else from the picture itself.
	/// Returns the new name to store in the palette.
	/// </summary>
	public static string Resized(string name, int size)
	{
		string stem = System.Text.RegularExpressions.Regex.Replace(Path.GetFileNameWithoutExtension(name), @"_\d+px$", "");
		string target = $"{stem}_{size}px.png";
		if (File.Exists(Path.Combine(Dir, target))) return target;
		string src = Path.Combine(OriginalsDir, stem + ".png");
		if (!File.Exists(src)) src = Path.Combine(Dir, Path.GetFileName(name));
		var img = Image.LoadFromFile(src);
		if (img == null || img.IsEmpty()) throw new InvalidOperationException("couldn't read " + Path.GetFileName(src));
		if (img.GetFormat() != Image.Format.Rgba8) img.Convert(Image.Format.Rgba8);
		int w = img.GetWidth(), h = img.GetHeight();
		float k = size / (float)Math.Max(w, h);
		// Growing beyond the original uses nearest-neighbour (keeps pixel art crisp); shrinking uses Lanczos.
		img.Resize(Math.Max(1, (int)MathF.Round(w * k)), Math.Max(1, (int)MathF.Round(h * k)),
			k > 1f ? Image.Interpolation.Nearest : Image.Interpolation.Lanczos);
		img.SavePng(Path.Combine(Dir, target));
		return target;
	}

	private static string Sanitize(string s)
	{
		var chars = s.ToCharArray();
		for (int i = 0; i < chars.Length; i++)
			if (!char.IsLetterOrDigit(chars[i]) && chars[i] != '-' && chars[i] != '_') chars[i] = '_';
		string r = new string(chars).Trim('_');
		return r.Length == 0 ? "picture" : (r.Length > 40 ? r[..40] : r);
	}

	/// <summary>The texture for a stored picture name, or null if the file is missing (e.g. a share code without it).</summary>
	public static Texture2D? Get(string? name)
	{
		if (string.IsNullOrWhiteSpace(name)) return null;
		string path = Path.Combine(Dir, Path.GetFileName(name));
		if (!File.Exists(path)) return null;
		long stamp = File.GetLastWriteTimeUtc(path).Ticks;
		if (_cache.TryGetValue(name, out var hit) && hit.stamp == stamp) return hit.tex;
		try
		{
			var img = Image.LoadFromFile(path);
			if (img == null || img.IsEmpty()) return null;
			if (!img.HasMipmaps()) img.GenerateMipmaps();
			var tex = ImageTexture.CreateFromImage(img);
			_cache[name] = (stamp, tex);
			return tex;
		}
		catch (Exception ex)
		{
			ModEntry.Log($"picture load failed ({name}): {ex.Message}");
			return null;
		}
	}
}
