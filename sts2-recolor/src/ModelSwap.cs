using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using System.Text.Json;
using Godot;

namespace SpireRecolor;

/// <summary>
/// "Repaint parts" custom models for characters. Every attachment image of a character's Spine atlas can be exported
/// as an upright PNG to mods/sts2_recolor/models/&lt;character&gt;/, edited in any paint program, and is pasted back
/// into the atlas pages at runtime (RenderingServer.TextureReplace) — skeleton and animations stay the game's own.
/// Edited parts may be larger than the original; the whole page is then upscaled (up to 4x) so no detail is lost.
/// </summary>
internal static class ModelSwap
{
	private sealed class Region
	{
		public string Name = "";
		public int Page;
		public int X, Y, W, H; // W/H are the upright size, as in the atlas "bounds"
		public bool Rotated;
	}

	private sealed class Atlas
	{
		public string SourcePath = "";
		public List<(string name, int w, int h)> Pages = new();
		public List<Region> Regions = new();
	}

	private sealed class PageState
	{
		public Image Original = null!;
		public Rid AppliedTo;
		public string Signature = "";
	}

	public const string OriginalsFolder = "_originals";
	private const int MaxPageSize = 8192;

	private static readonly Dictionary<string, Atlas> _atlases = new();
	private static readonly Dictionary<string, PageState> _pages = new(); // key: atlas path + "#" + page index

	public static string ModelsDir => Path.Combine(ModEntry.ModDir, "models");
	public static string CharacterDir(string key) => Path.Combine(ModelsDir, key);

	// ---------------------------------------------------------------- atlas access

	private static GodotObject? AtlasRes(Node spine)
	{
		var data = spine.Call("get_skeleton_data_res").AsGodotObject();
		return data?.Get("atlas_res").AsGodotObject();
	}

	private static Atlas? GetAtlas(GodotObject atlasRes)
	{
		string src = atlasRes.Call("get_source_path").AsString();
		if (string.IsNullOrEmpty(src))
			return null;
		if (_atlases.TryGetValue(src, out var cached))
			return cached;

		string? text = ReadAtlasText(src);
		if (text == null)
		{
			ModEntry.Log($"Model: could not read atlas text for {src}");
			return null;
		}
		var atlas = Parse(text);
		atlas.SourcePath = src;
		_atlases[src] = atlas;
		return atlas;
	}

	/// <summary>The .atlas is imported to a .spatlas JSON wrapper; find it through the .import remap.</summary>
	private static string? ReadAtlasText(string atlasPath)
	{
		string importText = Godot.FileAccess.GetFileAsString(atlasPath + ".import");
		string? imported = importText.Split('\n').Select(l => l.Trim())
			.FirstOrDefault(l => l.StartsWith("path=", StringComparison.Ordinal))?[5..].Trim('"');
		string raw = imported != null ? Godot.FileAccess.GetFileAsString(imported) : Godot.FileAccess.GetFileAsString(atlasPath);
		if (string.IsNullOrEmpty(raw))
			return null;
		if (raw.TrimStart().StartsWith("{"))
		{
			using var doc = JsonDocument.Parse(raw);
			return doc.RootElement.GetProperty("atlas_data").GetString();
		}
		return raw;
	}

	private static Atlas Parse(string text)
	{
		var atlas = new Atlas();
		int page = -1;
		Region? cur = null;
		bool expectPageName = true;
		foreach (string rawLine in text.Replace("\r", "").Split('\n'))
		{
			string line = rawLine.Trim();
			if (line.Length == 0)
			{
				expectPageName = true;
				cur = null;
				continue;
			}
			int colon = line.IndexOf(':');
			if (colon < 0)
			{
				if (expectPageName)
				{
					atlas.Pages.Add((line, 0, 0));
					page = atlas.Pages.Count - 1;
					expectPageName = false;
				}
				else
				{
					cur = new Region { Name = line, Page = page };
					atlas.Regions.Add(cur);
				}
				continue;
			}
			string k = line[..colon].Trim();
			int[] nums = line[(colon + 1)..].Split(',').Select(s => int.TryParse(s.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out int n) ? n : 0).ToArray();
			if (cur == null)
			{
				if (k == "size" && nums.Length >= 2)
					atlas.Pages[page] = (atlas.Pages[page].name, nums[0], nums[1]);
				continue;
			}
			switch (k)
			{
				case "bounds" when nums.Length >= 4:
					(cur.X, cur.Y, cur.W, cur.H) = (nums[0], nums[1], nums[2], nums[3]);
					break;
				case "xy" when nums.Length >= 2: // Spine 3.x style
					(cur.X, cur.Y) = (nums[0], nums[1]);
					break;
				case "size" when nums.Length >= 2:
					(cur.W, cur.H) = (nums[0], nums[1]);
					break;
				case "rotate":
				{
					string v = line[(colon + 1)..].Trim();
					cur.Rotated = v == "true" || v == "90" || v == "270";
					break;
				}
			}
		}
		return atlas;
	}

	private static Image OriginalPage(string pageKey, Texture2D tex)
	{
		if (_pages.TryGetValue(pageKey, out var st))
			return st.Original;
		Image img = tex.GetImage();
		if (img.IsCompressed())
			img.Decompress();
		img.Convert(Image.Format.Rgba8);
		_pages[pageKey] = new PageState { Original = img };
		return img;
	}

	private static string FileFor(string key, string region) =>
		Path.Combine(CharacterDir(key), region.Replace('/', Path.DirectorySeparatorChar) + ".png");

	private static string OriginalFileFor(string key, string region) =>
		Path.Combine(CharacterDir(key), OriginalsFolder, region.Replace('/', Path.DirectorySeparatorChar) + ".png");

	// ---------------------------------------------------------------- export

	/// <summary>Writes every part as an upright PNG into the character folder (and a pristine copy under _originals).</summary>
	public static int Export(string key, Node spine)
	{
		var res = AtlasRes(spine) ?? throw new InvalidOperationException("this model has no atlas");
		var atlas = GetAtlas(res) ?? throw new InvalidOperationException("atlas could not be read");
		var textures = res.Call("get_textures").AsGodotArray();
		int count = 0;
		foreach (var r in atlas.Regions)
		{
			if (r.Page < 0 || r.Page >= textures.Count || r.W <= 0 || r.H <= 0)
				continue;
			var tex = textures[r.Page].As<Texture2D>();
			if (tex == null)
				continue;
			Image page = OriginalPage(atlas.SourcePath + "#" + r.Page, tex);
			Image part = CutUpright(page, atlas.Pages[r.Page], r);

			string orig = OriginalFileFor(key, r.Name);
			Directory.CreateDirectory(Path.GetDirectoryName(orig)!);
			part.SavePng(orig);
			string active = FileFor(key, r.Name);
			if (!File.Exists(active)) // never overwrite someone's edit
			{
				Directory.CreateDirectory(Path.GetDirectoryName(active)!);
				File.Copy(orig, active);
			}
			count++;
		}
		File.WriteAllText(Path.Combine(CharacterDir(key), "HOW TO EDIT.txt"),
			"Edit (or replace) any PNG in this folder, then press \"Reload my edits\" in the F8 editor.\n" +
			"- You can paint at a bigger size than the original; it is scaled to fit (keep the same shape/proportions).\n" +
			"- Keep transparent areas transparent, and keep each part in the same pose/orientation.\n" +
			"- Delete a file (or copy it back from _originals) to return that part to normal.\n" +
			"- The _originals folder is a clean backup; the mod never reads it for drawing.\n");
		return count;
	}

	private static float PageScale((string name, int w, int h) page, Image img) =>
		page.w > 0 ? img.GetWidth() / (float)page.w : 1f;

	private static Image CutUpright(Image page, (string name, int w, int h) info, Region r)
	{
		float s = PageScale(info, page);
		int pw = r.Rotated ? r.H : r.W, ph = r.Rotated ? r.W : r.H;
		var rect = new Rect2I(Mathf.RoundToInt(r.X * s), Mathf.RoundToInt(r.Y * s), Math.Max(1, Mathf.RoundToInt(pw * s)), Math.Max(1, Mathf.RoundToInt(ph * s)));
		rect = rect.Intersection(new Rect2I(0, 0, page.GetWidth(), page.GetHeight()));
		Image part = page.GetRegion(rect);
		if (r.Rotated)
			part.Rotate90(ClockDirection.Clockwise);
		return part;
	}

	// ---------------------------------------------------------------- apply

	/// <summary>Makes sure this character's atlas pages show the edited parts (or the originals when switched off).</summary>
	public static void EnsureApplied(string key, Node spine)
	{
		try
		{
			var res = AtlasRes(spine);
			if (res == null)
				return;
			var atlas = GetAtlas(res);
			if (atlas == null)
				return;
			bool enabled = Palette.Get(key)?.CustomModel ?? true;
			var textures = res.Call("get_textures").AsGodotArray();
			for (int p = 0; p < atlas.Pages.Count && p < textures.Count; p++)
			{
				var tex = textures[p].As<Texture2D>();
				if (tex != null)
					ApplyPage(key, atlas, p, tex, enabled);
			}
		}
		catch (Exception ex)
		{
			ModEntry.Log($"Model apply failed for {key}: {ex}");
		}
	}

	/// <summary>Edited parts for this character (files that differ from the exported originals).</summary>
	public static List<string> EditedFiles(string key)
	{
		var list = new List<string>();
		string dir = CharacterDir(key);
		if (!Directory.Exists(dir))
			return list;
		string origDir = Path.Combine(dir, OriginalsFolder);
		foreach (string f in Directory.EnumerateFiles(dir, "*.png", SearchOption.AllDirectories))
		{
			string rel = Path.GetRelativePath(dir, f);
			if (rel.StartsWith(OriginalsFolder + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
				continue;
			if (!SameAsOriginal(f, Path.Combine(origDir, rel)))
				list.Add(f);
		}
		return list;
	}

	private static bool SameAsOriginal(string file, string original)
	{
		if (!File.Exists(original))
			return false;
		var a = new FileInfo(file);
		var b = new FileInfo(original);
		if (a.Length != b.Length)
			return false;
		return File.ReadAllBytes(file).AsSpan().SequenceEqual(File.ReadAllBytes(original));
	}

	private static void ApplyPage(string key, Atlas atlas, int p, Texture2D tex, bool enabled)
	{
		string pageKey = atlas.SourcePath + "#" + p;
		Image original = OriginalPage(pageKey, tex);
		var st = _pages[pageKey];

		var edits = new List<(Region r, string file)>();
		if (enabled)
		{
			foreach (var r in atlas.Regions.Where(r => r.Page == p))
			{
				string f = FileFor(key, r.Name);
				if (File.Exists(f) && !SameAsOriginal(f, OriginalFileFor(key, r.Name)))
					edits.Add((r, f));
			}
		}

		var sig = new StringBuilder();
		foreach (var (r, f) in edits)
		{
			var fi = new FileInfo(f);
			sig.Append(r.Name).Append('|').Append(fi.Length).Append('|').Append(fi.LastWriteTimeUtc.Ticks).Append(';');
		}
		string signature = sig.ToString();
		bool live = st.AppliedTo == tex.GetRid();
		if (live && st.Signature == signature)
			return;
		if (!live && signature.Length == 0)
			return; // untouched page on a fresh texture: nothing to do

		Image page;
		if (edits.Count == 0)
		{
			page = (Image)original.Duplicate();
		}
		else
		{
			var loaded = new List<(Region r, Image img)>();
			float k = 1f;
			float s0 = PageScale(atlas.Pages[p], original);
			foreach (var (r, f) in edits)
			{
				var img = Image.LoadFromFile(f);
				if (img == null || img.IsEmpty())
					continue;
				if (img.IsCompressed())
					img.Decompress();
				img.Convert(Image.Format.Rgba8);
				loaded.Add((r, img));
				k = Math.Max(k, Math.Max(img.GetWidth() / (r.W * s0), img.GetHeight() / (r.H * s0)));
			}
			int factor = Math.Clamp((int)Math.Ceiling(k - 0.05f), 1, 4);
			while (factor > 1 && Math.Max(original.GetWidth(), original.GetHeight()) * factor > MaxPageSize)
				factor--;

			page = (Image)original.Duplicate();
			if (factor > 1)
				page.Resize(original.GetWidth() * factor, original.GetHeight() * factor, Image.Interpolation.Lanczos);
			float s = s0 * factor;
			foreach (var (r, img) in loaded)
			{
				int w = Math.Max(1, Mathf.RoundToInt(r.W * s)), h = Math.Max(1, Mathf.RoundToInt(r.H * s));
				if (img.GetWidth() != w || img.GetHeight() != h)
					img.Resize(w, h, Image.Interpolation.Lanczos);
				if (r.Rotated)
					img.Rotate90(ClockDirection.Counterclockwise);
				page.BlitRect(img, new Rect2I(0, 0, img.GetWidth(), img.GetHeight()), new Vector2I(Mathf.RoundToInt(r.X * s), Mathf.RoundToInt(r.Y * s)));
			}
			ModEntry.Log($"Model: {key} page {p} — {loaded.Count} edited part(s), page scale x{factor}");
		}

		Rid replacement = RenderingServer.Texture2DCreate(page);
		RenderingServer.TextureReplace(tex.GetRid(), replacement);
		st.AppliedTo = tex.GetRid();
		st.Signature = signature;
	}

	// ---------------------------------------------------------------- share packs

	public static string IncomingDir => Path.Combine(ModEntry.ModDir, "incoming");

	/// <summary>Zip with the full palette plus every edited part — everything a friend needs to see the same thing.</summary>
	public static (string path, int parts) MakeSharePack()
	{
		Palette.Save();
		string zipPath = Path.Combine(ModEntry.ModDir, "SpireRecolor_share_pack.zip");
		if (File.Exists(zipPath))
			File.Delete(zipPath);
		int parts = 0;
		using (var zip = System.IO.Compression.ZipFile.Open(zipPath, System.IO.Compression.ZipArchiveMode.Create))
		{
			zip.CreateEntryFromFile(Palette.FilePath, "palette.json");
			if (Directory.Exists(PictureStore.Dir))
				foreach (string f in Directory.GetFiles(PictureStore.Dir, "*.png"))
					zip.CreateEntryFromFile(f, "textures/" + Path.GetFileName(f));
			if (Directory.Exists(ModelsDir))
			{
				foreach (string charDir in Directory.GetDirectories(ModelsDir))
				{
					string key = Path.GetFileName(charDir);
					foreach (string f in EditedFiles(key))
					{
						string rel = Path.GetRelativePath(ModEntry.ModDir, f).Replace('\\', '/');
						zip.CreateEntryFromFile(f, rel);
						parts++;
					}
				}
			}
		}
		return (zipPath, parts);
	}

	/// <summary>Imports every .zip in the incoming folder. Returns a human summary, or null if there was nothing.</summary>
	public static string? ImportIncoming()
	{
		if (!Directory.Exists(IncomingDir))
		{
			Directory.CreateDirectory(IncomingDir);
			return null;
		}
		var zips = Directory.GetFiles(IncomingDir, "*.zip");
		if (zips.Length == 0)
			return null;
		int parts = 0, targets = 0;
		string doneDir = Path.Combine(IncomingDir, "imported");
		Directory.CreateDirectory(doneDir);
		string root = Path.GetFullPath(ModEntry.ModDir) + Path.DirectorySeparatorChar;
		foreach (string zipPath in zips)
		{
			using (var zip = System.IO.Compression.ZipFile.OpenRead(zipPath))
			{
				foreach (var entry in zip.Entries)
				{
					if (entry.FullName.EndsWith("/"))
						continue;
					if (entry.FullName == "palette.json")
					{
						using var sr = new StreamReader(entry.Open());
						targets += Palette.ImportShareCode(sr.ReadToEnd());
						continue;
					}
					bool picture = entry.FullName.StartsWith("textures/", StringComparison.Ordinal);
					if ((!entry.FullName.StartsWith("models/", StringComparison.Ordinal) && !picture) || !entry.FullName.EndsWith(".png", StringComparison.OrdinalIgnoreCase))
						continue;
					string dest = Path.GetFullPath(Path.Combine(ModEntry.ModDir, entry.FullName));
					if (!dest.StartsWith(root, StringComparison.OrdinalIgnoreCase))
						continue; // ignore anything trying to escape the mod folder
					Directory.CreateDirectory(Path.GetDirectoryName(dest)!);
					entry.ExtractToFile(dest, true);
					parts++;
				}
			}
			string moved = Path.Combine(doneDir, Path.GetFileNameWithoutExtension(zipPath) + "_" + DateTime.Now.ToString("yyyyMMdd_HHmmss") + ".zip");
			File.Move(zipPath, moved);
		}
		Palette.Touch();
		return $"Loaded {zips.Length} share pack(s): {targets} recolor(s), {parts} repainted part(s).";
	}
}
