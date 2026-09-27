using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using MegaCrit.Sts2.Core.Nodes.Combat;
using MegaCrit.Sts2.Core.Nodes.RestSite;
using MegaCrit.Sts2.Core.Nodes.Screens.Shops;

namespace SpireRecolor;

/// <summary>
/// Finds character/monster visuals as they enter the scene tree and swaps their draw material for the recolor shader.
/// Purely cosmetic: it only changes materials on already-created nodes, never game state.
/// </summary>
internal static class Recolorer
{
	public const string KeyMeta = "sts2rc_key";
	private const string OrigMeta = "sts2rc_orig";
	private const string AppliedMeta = "sts2rc_applied";

	private static Shader? _shader;
	private static readonly List<ulong> _tracked = new();

	public static Shader Shader => _shader ??= new Shader { Code = RecolorShader.Code };

	public static void OnNodeAdded(Node node)
	{
		try
		{
			string? key = null;
			if (node is NCreatureVisuals)
			{
				if (node.HasMeta(KeyMeta))
					key = node.GetMeta(KeyMeta).AsString();
			}
			else if (node is NRestSiteCharacter rest)
			{
				key = rest.Player?.Character?.Id.Entry.ToLowerInvariant();
			}
			else if (node is NMerchantCharacter)
			{
				key = KeyFromScenePath(node.SceneFilePath, "/merchant/characters/", "_merchant");
			}
			else if (node is Control && node.SceneFilePath.Contains("/events/background_scenes/", StringComparison.Ordinal))
			{
				// An Ancient's event scene (res://scenes/events/background_scenes/<ancient>.tscn)
				string? k = node.HasMeta(KeyMeta) ? node.GetMeta(KeyMeta).AsString() : KeyFromScenePath(node.SceneFilePath, "/events/background_scenes/", "");
				if (k != null && IsAncientKey(k)) key = k;
			}
			if (string.IsNullOrEmpty(key))
				return;
			node.SetMeta(KeyMeta, key);
			ulong id = node.GetInstanceId();
			if (!_tracked.Contains(id))
				_tracked.Add(id);
			Callable.From(() => Apply(node)).CallDeferred();
		}
		catch (Exception ex)
		{
			ModEntry.Log($"OnNodeAdded failed: {ex}");
		}
	}

	private static HashSet<string>? _ancientKeys;
	public static bool IsAncientKey(string key)
	{
		if (_ancientKeys == null)
		{
			try { _ancientKeys = MegaCrit.Sts2.Core.Models.ModelDb.AllAncients.Select(a => a.Id.Entry.ToLowerInvariant()).ToHashSet(); }
			catch { return false; }
		}
		return _ancientKeys.Contains(key);
	}

	private static string? KeyFromScenePath(string path, string folder, string suffix)
	{
		int i = path.IndexOf(folder, StringComparison.Ordinal);
		if (i < 0 || !path.EndsWith(suffix + ".tscn", StringComparison.Ordinal))
			return null;
		int start = i + folder.Length;
		return path.Substring(start, path.Length - start - suffix.Length - ".tscn".Length);
	}

	/// <summary>Re-applies the current palette to every tracked creature still alive.</summary>
	public static void RefreshAll()
	{
		for (int i = _tracked.Count - 1; i >= 0; i--)
		{
			if (GodotObject.InstanceFromId(_tracked[i]) is Node n && GodotObject.IsInstanceValid(n))
				Apply(n);
			else
				_tracked.RemoveAt(i);
		}
	}

	public static void Apply(Node root)
	{
		if (!GodotObject.IsInstanceValid(root) || !root.HasMeta(KeyMeta))
			return;
		string key = root.GetMeta(KeyMeta).AsString();
		// Repainted parts only apply to the combat model; rest-site/shop scenes use different atlases.
		if (root is NCreatureVisuals && EditorUi.IsCharacterKey(key) && FindSpine(root) is { } spineNode)
			ModelSwap.EnsureApplied(key, spineNode);
		TargetRecolor? t = Palette.Get(key);
		bool highlighted = Highlight is { } hl && hl.key == key;
		bool idPass = IdPickKey == key;
		bool active = (((t != null && !t.IsIdentity) || highlighted) && !root.HasMeta("sts2rc_bypass")) || idPass;
		if (active && t == null)
			t = new TargetRecolor();
		Walk(root, root, t, active);
		// Fire / particle effects next to the body (e.g. the Necrobinder's head flames).
		try { EffectRecolor.Apply(root, key, t, active); }
		catch (Exception ex) { ModEntry.Log($"effect recolor failed: {ex.Message}"); }
	}

	public static Node? FindSpine(Node n)
	{
		if (n.GetClass() == "SpineSprite")
			return n;
		foreach (Node c in n.GetChildren())
			if (FindSpine(c) is { } found)
				return found;
		return null;
	}

	private static void Walk(Node root, Node node, TargetRecolor? t, bool active)
	{
		// Don't descend into another tracked creature (e.g. a pet parented under its owner) - it gets its own palette.
		if (node != root && node.HasMeta(KeyMeta))
			return;

		bool ancient = IsAncientKey(FindKey(root));
		if (node.GetClass() == "SpineSprite")
			ApplySpine(node, t, active);
		else if (node is Sprite2D or AnimatedSprite2D or Polygon2D && !ancient)
			ApplyCanvasItem((CanvasItem)node, t, active); // (Ancient scenes: never the room's lights/props)
		else if (ancient && node is TextureRect tr && tr.Texture is { } tex && tex.ResourcePath.Contains("/images/ancients/", StringComparison.Ordinal))
		{
			// Placeholder Ancients (Darv, Pael, Vakuu, ...) are one painted picture.
			if (tr.Material == null || (tr.Material is ShaderMaterial m0 && m0.Shader == Shader))
				ApplyCanvasItem(tr, t, active);
			else
				ApplyPictureCopy(tr, t, active); // drawn through the game's own shader (water ripples): recolor a copy
		}

		foreach (Node child in node.GetChildren())
			Walk(root, child, t, active);
	}

	private static void ApplySpine(Node spine, TargetRecolor? t, bool active)
	{
		Material? current = spine.Call("get_normal_material").As<Material>();
		bool ours = current is ShaderMaterial sm && sm.Shader == Shader;
		if (active)
		{
			ShaderMaterial mat;
			if (ours)
			{
				mat = (ShaderMaterial)current!;
			}
			else
			{
				if (current is null)
					spine.RemoveMeta(OrigMeta);
				else
					spine.SetMeta(OrigMeta, current);
				mat = NewMaterial(current);
				spine.Call("set_normal_material", mat);
			}
			Configure(mat, t!);
			spine.SetMeta(AppliedMeta, true);
			ApplyParts(spine, mat, t!);
		}
		else if (ours && spine.HasMeta(AppliedMeta))
		{
			Material? origMat = spine.HasMeta(OrigMeta) ? spine.GetMeta(OrigMeta).As<Material>() : null;
			// Carry over a hue the game may have written onto our material after we swapped it in.
			if (origMat is ShaderMaterial osm && current is ShaderMaterial csm)
				CopyGameHsv(csm, osm);
			spine.Call("set_normal_material", origMat!);
			spine.RemoveMeta(AppliedMeta);
			ApplyParts(spine, null, null);
		}
	}

	// ---------------------------------------------------------------- per-part (Spine slot) overrides

	private const string PartMeta = "sts2rc_part";
	private const string PartOrigMeta = "sts2rc_part_orig";

	/// <summary>Editor hook: briefly paints one part bright yellow so you can see which piece it is.</summary>
	public static (string key, string part)? Highlight;
	private static readonly TargetRecolor HighlightLook = new() { Tint = "#ffe030", TintStrength = 0.85f, Brightness = 1.25f };
	public static TargetRecolor HighlightLookPublic => HighlightLook;

	/// <summary>Click-to-select: while set to a creature key, every slot of that creature draws as its ID color.</summary>
	public static string? IdPickKey;
	/// <summary>The slot order the ID colors were assigned in (index i → color IdColor(i)).</summary>
	public static List<string> IdSlots = new();

	public static Vector3 IdColor(int i) => new Vector3((i + 1) * 3 / 255f, 0.5f, 0.25f);

	/// <summary>Which slot an ID-pass pixel belongs to, or null (background / an effect / not an ID pixel).</summary>
	public static string? SlotFromIdPixel(Color c)
	{
		if (c.A < 0.5f || Math.Abs(c.G - 0.5f) > 0.06f || Math.Abs(c.B - 0.25f) > 0.06f) return null;
		int i = (int)Math.Round(c.R * 255f / 3f) - 1;
		return i >= 0 && i < IdSlots.Count ? IdSlots[i] : null;
	}

	/// <summary>Slot names of a SpineSprite, in skeleton draw order.</summary>
	public static List<string> GetSlotNames(Node spine)
	{
		var names = new List<string>();
		try
		{
			var skeleton = spine.Call("get_skeleton").AsGodotObject();
			if (skeleton == null)
				return names;
			foreach (Variant slot in skeleton.Call("get_slots").AsGodotArray())
			{
				var data = slot.AsGodotObject()?.Call("get_data").AsGodotObject();
				string? name = data?.Call("get_name").AsString();
				if (!string.IsNullOrEmpty(name) && !names.Contains(name))
					names.Add(name);
			}
		}
		catch (Exception ex)
		{
			ModEntry.Log($"Reading part names failed: {ex.Message}");
		}
		return names;
	}

	private static void ApplyParts(Node spine, ShaderMaterial? bodyMat, TargetRecolor? t)
	{
		string key = FindKey(spine);
		var wanted = new Dictionary<string, TargetRecolor>();
		if (t?.Parts != null)
			foreach (var kv in t.Parts)
				if (!kv.Key.StartsWith(EffectRecolor.Prefix) && !kv.Key.StartsWith(PartGroups.Prefix))
					wanted[kv.Key] = kv.Value;
		if (IdPickKey == key)
		{
			// Click-to-select pass: every slot gets its own flat ID color, including additive/glow slots.
			IdSlots = GetSlotNames(spine);
			foreach (var slot in IdSlots) wanted[slot] = HighlightLook;
		}
		// Groups ("Left arm", "Clothes", "All flames"...): pieces without their own colors take the colors of the
		// smallest group covering them.
		List<string>? slots = null;
		if (t?.Parts != null && t.Parts.Keys.Any(k => k.StartsWith(PartGroups.Prefix) || k == EffectRecolor.AllFlames))
		{
			slots = GetSlotNames(spine);
			foreach (var (slot, look) in PartGroups.Resolve(slots, t.Parts))
				if (!wanted.ContainsKey(slot)) wanted[slot] = look;
		}
		if (bodyMat != null && Highlight is { } hl && hl.key == key)
		{
			if (hl.part.StartsWith(PartGroups.Prefix) || hl.part == EffectRecolor.AllFlames)
				foreach (var slot in PartGroups.MembersOf(hl.part, slots ?? GetSlotNames(spine)))
					wanted[slot] = HighlightLook;
			else if (!hl.part.StartsWith(EffectRecolor.Prefix))
				wanted[hl.part] = HighlightLook;
		}

		// Existing slot nodes (the game's own, or ones we added earlier), by slot name.
		var slotNodes = new Dictionary<string, Node>();
		foreach (Node child in spine.GetChildren())
		{
			if (child.GetClass() != "SpineSlotNode")
				continue;
			string slot = child.Get("slot_name").AsString();
			if (!string.IsNullOrEmpty(slot) && !slotNodes.ContainsKey(slot))
				slotNodes[slot] = child;
		}

		// Undo parts that are no longer wanted.
		foreach (var (slot, node) in slotNodes)
		{
			if (wanted.ContainsKey(slot) || !node.HasMeta(PartMeta))
				continue;
			if (node.GetMeta(PartMeta).AsString() == "added")
			{
				spine.RemoveChild(node);
				node.QueueFree();
			}
			else
			{
				node.Set("normal_material", node.HasMeta(PartOrigMeta) ? node.GetMeta(PartOrigMeta) : new Variant());
				node.RemoveMeta(PartMeta);
				node.RemoveMeta(PartOrigMeta);
				// put back the game's own glow/blend materials swapped out for a click-to-select pass
				foreach (string blend in new[] { "additive_material", "multiply_material", "screen_material" })
					if (node.HasMeta("sts2rc_idorig_" + blend))
					{
						node.Set(blend, node.GetMeta("sts2rc_idorig_" + blend));
						node.RemoveMeta("sts2rc_idorig_" + blend);
					}
			}
		}

		foreach (var (slot, look) in wanted)
		{
			if (!slotNodes.TryGetValue(slot, out Node? node))
			{
				node = ClassDB.Instantiate("SpineSlotNode").As<Node>();
				if (node == null)
					return;
				node.Set("slot_name", slot);
				node.SetMeta(PartMeta, "added");
				node.Name = "RecolorPart_" + slot;
				spine.AddChild(node);
			}
			else if (!node.HasMeta(PartMeta))
			{
				Variant orig = node.Get("normal_material");
				if (orig.VariantType != Variant.Type.Nil)
					node.SetMeta(PartOrigMeta, orig);
				node.SetMeta(PartMeta, "reused");
			}

			ShaderMaterial mat = node.Get("normal_material").As<Material>() is ShaderMaterial m && m.Shader == Shader
				? m
				: NewMaterial(bodyMat);
			if (bodyMat != null)
				CopyGameHsv(bodyMat, mat);
			Configure(mat, look);
			int idIndex = IdPickKey == key ? IdSlots.IndexOf(slot) : -1;
			mat.SetShaderParameter("rc_id_on", idIndex >= 0 ? 1f : 0f);
			if (idIndex >= 0) mat.SetShaderParameter("rc_id", IdColor(idIndex));
			node.Set("normal_material", mat);
			// glow slots draw with their additive material: during the ID pass use ours for those too
			foreach (string blend in new[] { "additive_material", "multiply_material", "screen_material" })
			{
				if (idIndex >= 0)
				{
					if (!node.HasMeta("sts2rc_idorig_" + blend)) node.SetMeta("sts2rc_idorig_" + blend, node.Get(blend));
					node.Set(blend, mat);
				}
				else if (node.HasMeta("sts2rc_idorig_" + blend))
				{
					node.Set(blend, node.GetMeta("sts2rc_idorig_" + blend));
					node.RemoveMeta("sts2rc_idorig_" + blend);
				}
			}
		}
	}

	private static string FindKey(Node n)
	{
		for (Node? cur = n; cur != null; cur = cur.GetParent())
			if (cur.HasMeta(KeyMeta))
				return cur.GetMeta(KeyMeta).AsString();
		return "";
	}

	private static void ApplyCanvasItem(CanvasItem item, TargetRecolor? t, bool active)
	{
		bool ours = item.Material is ShaderMaterial sm && sm.Shader == Shader;
		if (active)
		{
			if (!ours && item.Material != null)
				return; // leave special-blend vfx materials alone
			ShaderMaterial mat = ours ? (ShaderMaterial)item.Material! : NewMaterial(null);
			item.Material = mat;
			Configure(mat, t!);
		}
		else if (ours)
		{
			item.Material = null;
		}
	}

	// Orobas / Tanx: their picture goes through the game's water shader, so the recolor shader can't be added.
	// Instead the picture itself is replaced by a recolored copy (hue, saturation, brightness, contrast, tint).
	private const string OrigTexMeta = "sts2rc_origtex";
	private const string CopyLookMeta = "sts2rc_copylook";

	private static void ApplyPictureCopy(TextureRect tr, TargetRecolor? t, bool active)
	{
		if (!tr.HasMeta(OrigTexMeta)) tr.SetMeta(OrigTexMeta, tr.Texture);
		var orig = tr.GetMeta(OrigTexMeta).As<Texture2D>();
		if (!active || t == null || !t.Enabled || orig == null)
		{
			if (orig != null && tr.Texture != orig) tr.Texture = orig;
			tr.RemoveMeta(CopyLookMeta);
			return;
		}
		string sig = $"{t.Hue}|{t.Saturation}|{t.Brightness}|{t.Contrast}|{t.Tint}|{t.TintStrength}";
		if (tr.HasMeta(CopyLookMeta) && tr.GetMeta(CopyLookMeta).AsString() == sig) return;
		var img = orig.GetImage();
		if (img == null) return;
		if (img.IsCompressed()) img.Decompress();
		img.Convert(Image.Format.Rgba8);
		byte[] data = img.GetData();
		for (int i = 0; i < data.Length; i += 4)
		{
			if (data[i + 3] == 0) continue;
			var c = EffectRecolor.Transform(new Color(data[i] / 255f, data[i + 1] / 255f, data[i + 2] / 255f, 1f), t);
			data[i] = (byte)Math.Clamp((int)(c.R * 255f + 0.5f), 0, 255);
			data[i + 1] = (byte)Math.Clamp((int)(c.G * 255f + 0.5f), 0, 255);
			data[i + 2] = (byte)Math.Clamp((int)(c.B * 255f + 0.5f), 0, 255);
		}
		var outImg = Image.CreateFromData(img.GetWidth(), img.GetHeight(), false, Image.Format.Rgba8, data);
		tr.Texture = ImageTexture.CreateFromImage(outImg);
		tr.SetMeta(CopyLookMeta, sig);
	}

	private static ShaderMaterial NewMaterial(Material? previous)
	{
		var mat = new ShaderMaterial { Shader = Shader };
		if (previous is ShaderMaterial prev)
			CopyGameHsv(prev, mat);
		return mat;
	}

	private static void CopyGameHsv(ShaderMaterial from, ShaderMaterial to)
	{
		foreach (string p in new[] { "h", "s", "v" })
		{
			Variant val = from.GetShaderParameter(p);
			if (val.VariantType is Variant.Type.Float or Variant.Type.Int)
				to.SetShaderParameter(p, val);
		}
	}

	public static void Configure(ShaderMaterial mat, TargetRecolor t)
	{
		if (!t.Enabled)
			t = new TargetRecolor(); // a switched-off part shows its original colors
		mat.SetShaderParameter("rc_hue", t.Hue / 360f);
		mat.SetShaderParameter("rc_sat", t.Saturation);
		mat.SetShaderParameter("rc_bright", t.Brightness);
		mat.SetShaderParameter("rc_contrast", t.Contrast);
		Color tint = ParseColor(t.Tint, Colors.White);
		mat.SetShaderParameter("rc_tint_hsv", new Vector3(tint.H, tint.S, tint.V));
		mat.SetShaderParameter("rc_tint_amt", t.TintStrength);

		int n = Math.Min(t.Swaps.Count, RecolorShader.MaxSwaps);
		// vec4 arrays (range packed in src.w): vec3 uniform arrays don't upload reliably.
		var src = new Vector4[RecolorShader.MaxSwaps];
		var dst = new Vector4[RecolorShader.MaxSwaps];
		for (int i = 0; i < n; i++)
		{
			Color a = ParseColor(t.Swaps[i].From, Colors.Red);
			Color b = ParseColor(t.Swaps[i].To, Colors.Blue);
			src[i] = new Vector4(a.H, a.S, a.V, t.Swaps[i].Range);
			dst[i] = new Vector4(b.H, b.S, b.V, 0f);
		}
		Texture2D? pic = t.HasPicture ? PictureStore.Get(t.Picture) : null;
		mat.SetShaderParameter("rc_pic_amt", pic != null ? Math.Clamp(t.PictureOpacity, 0f, 1f) : 0f);
		if (pic != null) mat.SetShaderParameter("rc_pic", pic);
		mat.SetShaderParameter("rc_pic_mode", t.PictureMode == "texture" ? 1 : 0);
		mat.SetShaderParameter("rc_pic_scale", Math.Clamp(t.PictureScale, 0.1f, 64f));
		mat.SetShaderParameter("rc_swap_count", n);
		mat.SetShaderParameter("rc_src", src);
		mat.SetShaderParameter("rc_dst", dst);
	}

	public static Color ParseColor(string? s, Color fallback)
	{
		if (string.IsNullOrWhiteSpace(s))
			return fallback;
		return Color.HtmlIsValid(s) ? Color.FromHtml(s) : fallback;
	}

	public static string ToHex(Color c) => "#" + c.ToHtml(false);
}
