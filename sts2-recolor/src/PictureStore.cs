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
	private static readonly Dictionary<string, (long stamp, ImageTexture tex)> _cache = new();

	public static string Dir => Path.Combine(ModEntry.ModDir, "textures");

	/// <summary>Copy a picture into textures/ and return the name to store in the palette.</summary>
	public static string Import(string sourcePath)
	{
		var img = Image.LoadFromFile(sourcePath);
		if (img == null || img.IsEmpty())
			throw new InvalidOperationException("That file isn't a picture Godot can read (use PNG, JPG or WEBP).");
		int w = img.GetWidth(), h = img.GetHeight();
		if (Math.Max(w, h) > MaxSize)
		{
			float k = MaxSize / (float)Math.Max(w, h);
			img.Resize(Math.Max(1, (int)(w * k)), Math.Max(1, (int)(h * k)), Image.Interpolation.Lanczos);
		}
		if (img.GetFormat() != Image.Format.Rgba8)
			img.Convert(Image.Format.Rgba8);
		img.GenerateMipmaps();
		Directory.CreateDirectory(Dir);
		string baseName = Sanitize(Path.GetFileNameWithoutExtension(sourcePath));
		string name = baseName + ".png";
		for (int i = 2; File.Exists(Path.Combine(Dir, name)); i++)
			name = $"{baseName}_{i}.png";
		img.SavePng(Path.Combine(Dir, name));
		return name;
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
