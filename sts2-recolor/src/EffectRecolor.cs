using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using Godot;

namespace SpireRecolor;

/// <summary>
/// Recolors a creature's visual EFFECTS: fire/particle nodes that sit next to the Spine body instead of being
/// skeleton parts (Joseph, 2026-09-27: "color editor can't edit necrobinder's head flames"). The Necrobinder's head
/// fire is a Sprite2D with its own fire shader (colors in shader parameters such as OuterColor / InnerColor), and
/// its scythe flames and sparks are GPUParticles2D (colors in the particle color / color gradients).
///
/// Each effect shows up in the editor's part list as "fx:&lt;name&gt;" and uses the same look settings (hue,
/// saturation, brightness, contrast, tint). The look is applied to those COLOR VALUES directly, so the effect keeps
/// its own shader, shape and animation. Effects are untouched unless their part is customised, so older palettes
/// look exactly as before. If the game's own script changes an effect's colors (e.g. at low health) the new value
/// becomes the base and the look is re-applied on top, every frame.
/// </summary>
internal static class EffectRecolor
{
	public const string Prefix = "fx:";

	/// <summary>
	/// One part that colors every flame at once (Joseph, 2026-09-27: yes to an "All flames" option): the fire effects
	/// plus the skeleton's own flame/glow pieces (the Necrobinder's neck/back flames, eye flames, head and eye glows).
	/// A piece with its own colors still overrides the group.
	/// </summary>
	public const string AllFlames = "fx:All flames";
	private static readonly HashSet<string> FlameGlowSlots = new(StringComparer.OrdinalIgnoreCase)
	{ "glow_head", "eye_glow_l", "eye_glow_r", "scythe_glow" };

	public static bool IsFlameSlot(string slot)
		=> slot.Contains("flame", StringComparison.OrdinalIgnoreCase) || slot.Contains("fire", StringComparison.OrdinalIgnoreCase)
		   || FlameGlowSlots.Contains(slot);

	public static bool IsFlameEffect(string label)
		=> label.Contains("flame", StringComparison.OrdinalIgnoreCase) || label.Contains("fire", StringComparison.OrdinalIgnoreCase);

	private static readonly Dictionary<string, string> Labels = new()
	{
		["SteppedFireMix_dark"] = "Head flames",
		["ScytheParticles"] = "Scythe flames",
		["LowHealthParticles"] = "Low-health sparks",
		["HurtParticles"] = "Hurt sparks",
	};

	private sealed class State
	{
		public ulong NodeId;
		public TargetRecolor? Look;
		public ShaderMaterial? Mat;                                     // our private copy of the effect's shader material
		public readonly Dictionary<string, Color> Orig = new();        // base colors (shader params)
		public readonly Dictionary<string, Color> Written = new();     // what we last wrote
		public ParticleProcessMaterial? Proc;                          // our private copy of the particle material
		public Color ProcOrig, ProcWritten;
		public readonly List<(Gradient g, Color[] orig)> Ramps = new();
	}

	private static readonly Dictionary<ulong, State> _states = new();

	public static string Display(string partName)
		=> partName == AllFlames ? "All flames (fire + glows)"
		 : partName.StartsWith(Prefix) ? "Effect: " + partName[Prefix.Length..] : partName;

	public static string LabelOf(Node n)
	{
		string name = n.Name.ToString();
		return Labels.TryGetValue(name, out var l) ? l : Humanize(name);
	}

	private static string Humanize(string s)
	{
		var sb = new StringBuilder();
		for (int i = 0; i < s.Length; i++)
		{
			char c = s[i] == '_' ? ' ' : s[i];
			if (i > 0 && char.IsUpper(c) && char.IsLower(s[i - 1])) sb.Append(' ');
			sb.Append(c);
		}
		return sb.ToString().Trim();
	}

	private static bool IsEffect(Node n)
	{
		if (n is GpuParticles2D || n is CpuParticles2D)
			return true;
		if (n is CanvasItem ci && (n is Sprite2D || n is AnimatedSprite2D) && ci.Material is ShaderMaterial sm
		    && sm.Shader != null && sm.Shader != Recolorer.Shader)
			return ColorParams(sm).Any();
		return false;
	}

	private static IEnumerable<string> ColorParams(ShaderMaterial sm)
	{
		foreach (var u in sm.Shader.GetShaderUniformList())
		{
			string name = u.AsGodotDictionary()["name"].AsString();
			if (sm.GetShaderParameter(name).VariantType == Variant.Type.Color)
				yield return name;
		}
	}

	public static List<Node> FindEffects(Node root)
	{
		var list = new List<Node>();
		// Ancient scenes: only effects that belong to the Ancient's own (Spine) art, not the room's lights and fog.
		bool ancient = root.HasMeta(Recolorer.KeyMeta) && Recolorer.IsAncientKey(root.GetMeta(Recolorer.KeyMeta).AsString());
		Node? spine = ancient ? Recolorer.FindSpine(root) : null;
		if (ancient && spine == null) return list;
		void Walk(Node n)
		{
			if (n != root && n.HasMeta(Recolorer.KeyMeta)) return; // another creature (pet) has its own palette
			if (IsEffect(n)) list.Add(n);
			foreach (Node c in n.GetChildren()) Walk(c);
		}
		Walk(spine ?? root);
		return list;
	}

	public static List<string> PartNames(Node root)
	{
		var list = FindEffects(root).Select(n => Prefix + LabelOf(n)).Distinct().OrderBy(x => x, StringComparer.OrdinalIgnoreCase).ToList();
		bool anyFlame = list.Any(p => IsFlameEffect(p));
		if (!anyFlame && Recolorer.FindSpine(root) is { } spine)
			anyFlame = Recolorer.GetSlotNames(spine).Any(IsFlameSlot);
		if (anyFlame) list.Insert(0, AllFlames);
		return list;
	}

	/// <summary>Called from Recolorer.Apply for every creature refresh.</summary>
	public static void Apply(Node root, string key, TargetRecolor? t, bool active)
	{
		foreach (var e in FindEffects(root))
		{
			string part = Prefix + LabelOf(e);
			TargetRecolor? look = null;
			bool flame = IsFlameEffect(part);
			if (active && t?.Parts != null)
			{
				if (t.Parts.TryGetValue(part, out var l)) look = l.Enabled ? l : null;              // its own colors win
				else if (flame && t.Parts.TryGetValue(AllFlames, out var g) && g.Enabled) look = g; // else the group's
			}
			if (Recolorer.Highlight is { } hl && hl.key == key && (hl.part == part || (flame && hl.part == AllFlames)))
				look = Recolorer.HighlightLookPublic;
			SetLook(e, look);
		}
	}

	private static void SetLook(Node e, TargetRecolor? look)
	{
		ulong id = e.GetInstanceId();
		if (!_states.TryGetValue(id, out var st))
		{
			if (look == null) return; // never touched, nothing to undo
			st = new State { NodeId = id };
			Prepare(e, st);
			_states[id] = st;
		}
		st.Look = look;
		Write(st, force: true);
	}

	// Give the node private copies of its materials (they're shared with every other Necrobinder) and remember
	// the original colors.
	private static void Prepare(Node e, State st)
	{
		if (e is CanvasItem ci && ci.Material is ShaderMaterial sm && sm.Shader != Recolorer.Shader && !(e is GpuParticles2D || e is CpuParticles2D))
		{
			st.Mat = (ShaderMaterial)sm.Duplicate();
			ci.Material = st.Mat;
			foreach (var p in ColorParams(st.Mat))
				st.Orig[p] = st.Mat.GetShaderParameter(p).AsColor();
		}
		if (e is GpuParticles2D gp && gp.ProcessMaterial is ParticleProcessMaterial pm)
		{
			st.Proc = (ParticleProcessMaterial)pm.Duplicate();
			foreach (var tex in new[] { st.Proc.ColorRamp, st.Proc.ColorInitialRamp })
				if (tex is GradientTexture1D gt && gt.Gradient != null)
				{
					var copy = (GradientTexture1D)gt.Duplicate();
					copy.Gradient = (Gradient)gt.Gradient.Duplicate();
					if (tex == st.Proc.ColorRamp) st.Proc.ColorRamp = copy; else st.Proc.ColorInitialRamp = copy;
					st.Ramps.Add((copy.Gradient, copy.Gradient.Colors.ToArray()));
				}
			st.ProcOrig = st.Proc.Color;
			gp.ProcessMaterial = st.Proc;
		}
		if (e is CpuParticles2D cp)
		{
			st.ProcOrig = cp.Color;
			if (cp.ColorRamp != null) { cp.ColorRamp = (Gradient)cp.ColorRamp.Duplicate(); st.Ramps.Add((cp.ColorRamp, cp.ColorRamp.Colors.ToArray())); }
			if (cp.ColorInitialRamp != null) { cp.ColorInitialRamp = (Gradient)cp.ColorInitialRamp.Duplicate(); st.Ramps.Add((cp.ColorInitialRamp, cp.ColorInitialRamp.Colors.ToArray())); }
		}
	}

	private static void Write(State st, bool force)
	{
		if (GodotObject.InstanceFromId(st.NodeId) is not Node e || !GodotObject.IsInstanceValid(e)) { _states.Remove(st.NodeId); return; }
		var look = st.Look;
		if (st.Mat != null)
			foreach (var p in st.Orig.Keys.ToList())
			{
				Color cur = st.Mat.GetShaderParameter(p).AsColor();
				if (st.Written.TryGetValue(p, out var w) && !Same(cur, w)) st.Orig[p] = cur; // the game changed it: new base
				else if (!force) continue;
				Color v = look == null ? st.Orig[p] : Transform(st.Orig[p], look);
				st.Mat.SetShaderParameter(p, v);
				st.Written[p] = v;
			}
		if (e is GpuParticles2D && st.Proc != null)
		{
			if (!Same(st.Proc.Color, st.ProcWritten) && st.ProcWritten != default) st.ProcOrig = st.Proc.Color;
			if (force || !Same(st.Proc.Color, st.ProcWritten))
			{
				st.ProcWritten = look == null ? st.ProcOrig : Transform(st.ProcOrig, look);
				st.Proc.Color = st.ProcWritten;
			}
		}
		if (e is CpuParticles2D cp && force)
			cp.Color = look == null ? st.ProcOrig : Transform(st.ProcOrig, look);
		if (force)
			foreach (var (g, orig) in st.Ramps)
				g.Colors = look == null ? orig : orig.Select(c => Transform(c, look)).ToArray();
	}

	/// <summary>Per frame: re-apply on top of any color the game's own effect script just changed.</summary>
	public static void Tick()
	{
		if (_states.Count == 0) return;
		foreach (var st in _states.Values.ToList())
			if (st.Look != null) Write(st, force: false);
	}

	private static bool Same(Color a, Color b) => Math.Abs(a.R - b.R) < 1e-4f && Math.Abs(a.G - b.G) < 1e-4f && Math.Abs(a.B - b.B) < 1e-4f && Math.Abs(a.A - b.A) < 1e-4f;

	// The same look math the body shader uses (hue shift, saturation, contrast, brightness, tint), on one color.
	// Values above 1 (glow) are kept; alpha is untouched.
	public static Color Transform(Color c, TargetRecolor t)
	{
		float h = c.H, s = c.S, v = c.V;
		h = ((h + t.Hue / 360f) % 1f + 1f) % 1f;
		s = Math.Clamp(s * t.Saturation, 0f, 1f);
		var o = Color.FromHsv(h, s, v, c.A);
		float r = ((o.R - 0.5f) * t.Contrast + 0.5f) * t.Brightness;
		float g = ((o.G - 0.5f) * t.Contrast + 0.5f) * t.Brightness;
		float b = ((o.B - 0.5f) * t.Contrast + 0.5f) * t.Brightness;
		o = new Color(Math.Max(r, 0f), Math.Max(g, 0f), Math.Max(b, 0f), c.A);
		if (t.TintStrength > 0.001f)
		{
			Color tint = Recolorer.ParseColor(t.Tint, Colors.White);
			var tinted = Color.FromHsv(tint.H, tint.S, o.V * tint.V, c.A);
			o = o.Lerp(tinted, Math.Clamp(t.TintStrength, 0f, 1f));
			o.A = c.A;
		}
		return o;
	}
}
