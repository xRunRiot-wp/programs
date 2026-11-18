using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace SpireRecolor;

/// <summary>
/// Saved looks ("profiles") per creature (Joseph, 2026-09-27: "make it so you can save an appearance as a profile").
/// Each profile is the creature's whole look — colors, swaps, pictures, every part and group — stored as
/// profiles/&lt;creature&gt;/&lt;name&gt;.rcprofile (not .json: the game reads .json files in mods/ as manifests).
/// Pictures stay in textures/ and are referenced by name. Saving never overwrites: a taken name gets " (2)".
/// </summary>
internal static class Profiles
{
	public const string Ext = ".rcprofile";
	private static readonly JsonSerializerOptions JsonOpts = new() { WriteIndented = true };

	private sealed class ProfileFile
	{
		[JsonPropertyName("profileFormat")] public int Format { get; set; } = 1;
		[JsonPropertyName("creature")] public string Creature { get; set; } = "";
		[JsonPropertyName("name")] public string Name { get; set; } = "";
		[JsonPropertyName("saved")] public string Saved { get; set; } = "";
		[JsonPropertyName("look")] public TargetRecolor Look { get; set; } = new();
	}

	public static string Root => Path.Combine(ModEntry.ModDir, "profiles");
	private static string Dir(string key) => Path.Combine(Root, Clean(key));

	private static string Clean(string s)
	{
		var bad = Path.GetInvalidFileNameChars();
		string r = new string(s.Trim().Select(c => bad.Contains(c) ? '_' : c).ToArray()).Trim('.', ' ');
		return r.Length == 0 ? "look" : (r.Length > 50 ? r[..50] : r);
	}

	/// <summary>Saved profile names for a creature, newest first.</summary>
	public static List<string> List(string key)
	{
		string d = Dir(key);
		if (!Directory.Exists(d)) return new List<string>();
		return Directory.GetFiles(d, "*" + Ext)
			.OrderByDescending(File.GetLastWriteTimeUtc)
			.Select(f => Path.GetFileNameWithoutExtension(f)!)
			.ToList();
	}

	/// <summary>Save a copy of this look under a new name; returns the name actually used.</summary>
	public static string Save(string key, string name, TargetRecolor look)
	{
		string d = Dir(key);
		Directory.CreateDirectory(d);
		string baseName = Clean(name), final = baseName;
		for (int i = 2; File.Exists(Path.Combine(d, final + Ext)); i++)
			final = $"{baseName} ({i})";
		var file = new ProfileFile { Creature = key, Name = final, Saved = DateTime.Now.ToString("yyyy-MM-dd HH:mm"), Look = look };
		File.WriteAllText(Path.Combine(d, final + Ext), JsonSerializer.Serialize(file, JsonOpts));
		return final;
	}

	/// <summary>A fresh copy of a saved look (null if missing or unreadable).</summary>
	public static TargetRecolor? Load(string key, string name)
	{
		string p = Path.Combine(Dir(key), Clean(name) + Ext);
		if (!File.Exists(p)) return null;
		try { return JsonSerializer.Deserialize<ProfileFile>(File.ReadAllText(p), JsonOpts)?.Look; }
		catch (Exception ex) { ModEntry.Log($"profile {name} unreadable: {ex.Message}"); return null; }
	}

	public static bool Delete(string key, string name)
	{
		string p = Path.Combine(Dir(key), Clean(name) + Ext);
		if (!File.Exists(p)) return false;
		File.Delete(p);
		return true;
	}

	/// <summary>Deep copy through JSON (for Undo).</summary>
	public static TargetRecolor Copy(TargetRecolor t) =>
		JsonSerializer.Deserialize<TargetRecolor>(JsonSerializer.Serialize(t)) ?? new TargetRecolor();
}
