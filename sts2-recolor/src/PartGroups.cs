using System;
using System.Collections.Generic;
using System.Linq;

namespace SpireRecolor;

/// <summary>
/// Groups of skeleton parts shown at the top of the part list (Joseph, 2026-09-27: "consolidate a lot of the body
/// parts (still have the option to do individual parts) and put the bigger pieces up top"). Built from slot names,
/// so it works for any character: "l upper arm", "l_hand_back", "l index_back" → Left arm; "skirt flap" → Clothes...
///
/// Priority when a piece is covered more than once: its own colors, else the SMALLEST group that has colors
/// (more specific wins), else the whole body. "All flames" (EffectRecolor.AllFlames) takes part in the same rule.
/// </summary>
internal static class PartGroups
{
	public const string Prefix = "grp:";

	private static readonly string[] ArmWords = { "arm", "hand", "finger", "index", "pinky", "ring", "middle", "thumb", "shoulder", "sleeve", "elbow", "wrist", "glove", "claw" };
	private static readonly string[] LegWords = { "leg", "foot", "feet", "knee", "thigh", "shin", "toe", "boot", "ankle", "calf" };
	private static readonly string[] FireWords = { "flame", "fire", "glow" };

	private static bool Has(string s, params string[] words) => words.Any(w => s.Contains(w, StringComparison.OrdinalIgnoreCase));

	// Which side a slot is on from names like "l hand", "l_hand_back", "sleeve_l_extended", "left_arm", "arm_r".
	private static char Side(string s)
	{
		string x = " " + s.ToLowerInvariant().Replace('_', ' ').Replace('-', ' ').Replace('.', ' ') + " ";
		if (x.Contains(" l ") || x.Contains(" left ")) return 'l';
		if (x.Contains(" r ") || x.Contains(" right ")) return 'r';
		return ' ';
	}

	private static readonly (string Name, Func<string, bool> Match)[] Defs =
	{
		("Left arm", s => Side(s) == 'l' && Has(s, ArmWords)),
		("Right arm", s => Side(s) == 'r' && Has(s, ArmWords)),
		("Left leg", s => Side(s) == 'l' && Has(s, LegWords)),
		("Right leg", s => Side(s) == 'r' && Has(s, LegWords)),
		("Head", s => Has(s, "head", "skull", "face", "eye", "hair", "helmet", "hat", "jaw", "mouth", "mask", "horn", "ear", "nose", "brow", "crown", "hood") && !Has(s, FireWords)),
		("Torso", s => Side(s) == ' ' && Has(s, "chest", "torso", "rib", "spine", "belly", "belt", "waist", "pelvis", "hip", "neck", "body", "back") && !Has(s, FireWords) && !Has(s, "shadow")),
		("Clothes", s => Has(s, "skirt", "robe", "dress", "sleeve", "cloth", "pants", "shirt", "scarf", "flap", "cape", "cloak", "coat", "collar", "tabard", "sash")),
		("Weapon", s => Has(s, "sword", "scythe", "sythe", "blade", "staff", "weapon", "shield", "gun", "bow", "clipper", "dagger", "axe", "spear", "wand")),
		("Shadows", s => Has(s, "shadow")),
	};

	/// <summary>Groups with at least 2 members for these slots, biggest first.</summary>
	public static List<(string Key, List<string> Members)> For(IEnumerable<string> slots)
	{
		var all = slots.ToList();
		var list = new List<(string, List<string>)>();
		foreach (var (name, match) in Defs)
		{
			var members = all.Where(match).ToList();
			if (members.Count >= 2) list.Add((Prefix + name, members));
		}
		return list.OrderByDescending(g => g.Item2.Count).ToList();
	}

	/// <summary>Every group (body groups + "All flames") over these slots, for resolving colors.</summary>
	public static List<(string Key, List<string> Members)> WithFlames(IEnumerable<string> slots)
	{
		var all = slots.ToList();
		var list = For(all);
		var flames = all.Where(EffectRecolor.IsFlameSlot).ToList();
		if (flames.Count > 0) list.Add((EffectRecolor.AllFlames, flames));
		return list;
	}

	/// <summary>
	/// For each slot without its own colors: the colors of the smallest group covering it that has colors.
	/// </summary>
	public static Dictionary<string, TargetRecolor> Resolve(IEnumerable<string> slots, IReadOnlyDictionary<string, TargetRecolor> parts)
	{
		var result = new Dictionary<string, TargetRecolor>();
		var groups = WithFlames(slots).Where(g => parts.TryGetValue(g.Key, out var l) && l.Enabled)
			.OrderBy(g => g.Members.Count).ToList();
		foreach (var (key, members) in groups)
			foreach (var slot in members)
				if (!parts.ContainsKey(slot) && !result.ContainsKey(slot))
					result[slot] = parts[key];
		return result;
	}

	public static List<string> MembersOf(string key, IEnumerable<string> slots)
		=> WithFlames(slots).FirstOrDefault(g => g.Key == key).Members ?? new List<string>();
}
