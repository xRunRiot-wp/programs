using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Collections.Concurrent;
using System.Threading;
using System.Threading.Tasks;
using Godot;
using MegaCrit.Sts2.Core.Models;

namespace SpireRecolor;

/// <summary>
/// Test-hook tools for exporting game art losslessly (Joseph, 2026-09-27: "send me a lossless version of the ancients
/// moving backgrounds/art, including the characters").
///   record &lt;ancient&gt; &lt;dir&gt; &lt;seconds&gt; &lt;fps&gt; : plays that Ancient's event scene in an offscreen 1920x1080 viewport
///                                           and saves every frame as PNG (numbered), plus timing.txt.
///   exporttex &lt;res://path&gt; &lt;out.png&gt;       : decodes a game texture exactly as the game has it and saves it as PNG.
/// Nothing is shown on screen; the palette is not involved.
/// </summary>
internal static class Recorder
{
	private static SubViewport? _vp;
	private static string _dir = "";
	private static int _warm, _frame, _total, _prevMaxFps;
	private static readonly List<ulong> _ticks = new();
	// Frames go to ONE raw file (frames.raw: width*height*bpp bytes each, no compression) through a background
	// writer, so capturing keeps up with 60 fps; ffmpeg compresses them losslessly afterwards.
	private static BlockingCollection<byte[]>? _queue;
	private static Thread? _writer;
	private static string _meta = "";

	public static bool Busy => _vp != null;

	public static void Start(string key, string dir, float seconds, int fps)
	{
		if (Busy) throw new InvalidOperationException("already recording");
		var an = ModelDb.AllAncients.FirstOrDefault(a => a.Id.Entry.Equals(key, StringComparison.OrdinalIgnoreCase))
		         ?? throw new ArgumentException("no ancient " + key);
		var scene = an.CreateBackgroundScene().Instantiate<Control>(PackedScene.GenEditState.Disabled);
		scene.SetMeta("sts2rc_bypass", true); // original colors
		Begin(scene, key, dir, seconds, fps, s =>
		{
			var c = (Control)s;
			c.Position = Vector2.Zero;
			c.Size = new Vector2(1920, 1080);
		});
	}

	/// <summary>
	/// Combat backgrounds (Joseph, 2026-09-27: "there are backgrounds like this in the game, can you also find, put
	/// those together, and record them like the ancients"). Built the way the game does it (NCombatBackground +
	/// one variant per depth layer + a foreground), with the chosen layer files, framed exactly as in combat
	/// (the room centres it at 983,540 on a 1920x1080 screen).
	///   recordbg &lt;title&gt; &lt;dir&gt; &lt;seconds&gt; &lt;fps&gt; &lt;layer1.tscn,layer2.tscn,...&gt;   (layer file names, bg and fg)
	/// </summary>
	public static void StartBackground(string title, string dir, float seconds, int fps, string layers)
	{
		if (Busy) throw new InvalidOperationException("already recording");
		string folder = $"res://scenes/backgrounds/{title}";
		var bg = ResourceLoader.Load<PackedScene>($"{folder}/{title}_background.tscn")?.Instantiate<Control>(PackedScene.GenEditState.Disabled)
		         ?? throw new ArgumentException("no background " + title);
		var files = layers.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
		// depth layers in depth order go to Layer_00, Layer_01, ... (as the game does); the _fg_ one to Foreground
		var bgFiles = files.Where(f => f.Contains("_bg_")).OrderBy(f => f.Split("_bg_")[1], StringComparer.Ordinal).ToList();
		for (int i = 0; i < bgFiles.Count; i++) AddLayer(bg, $"Layer_{i:D2}", $"{folder}/layers/{bgFiles[i]}");
		foreach (var fg in files.Where(f => f.Contains("_fg_"))) AddLayer(bg, "Foreground", $"{folder}/layers/{fg}");
		var holder = new Control { Position = new Vector2(983, 540), MouseFilter = Control.MouseFilterEnum.Ignore };
		holder.AddChild(bg);
		Begin(holder, title, dir, seconds, fps, null);
	}

	private static void AddLayer(Control bg, string node, string path)
	{
		var slot = bg.GetNodeOrNull(node) ?? throw new ArgumentException($"{node} missing for {path}");
		var layer = ResourceLoader.Load<PackedScene>(path)?.Instantiate<Control>(PackedScene.GenEditState.Disabled)
		            ?? throw new ArgumentException("can't load " + path);
		layer.Visible = true;
		slot.AddChild(layer);
	}

	private static void Begin(Node scene, string key, string dir, float seconds, int fps, Action<Node>? place)
	{
		var root = ((SceneTree)Engine.GetMainLoop()).Root;
		_vp = new SubViewport
		{
			Size = new Vector2I(1920, 1080), RenderTargetUpdateMode = SubViewport.UpdateMode.Always,
			TransparentBg = false, Disable3D = true, Name = "RecolorRecorder",
		};
		root.AddChild(_vp);
		_vp.AddChild(scene);
		place?.Invoke(scene);
		Directory.CreateDirectory(dir);
		_dir = dir;
		_warm = 45;                    // let particles / animations get going first
		_frame = 0;
		_total = Math.Max(1, (int)(seconds * fps));
		_prevMaxFps = Engine.MaxFps;
		Engine.MaxFps = fps;
		_ticks.Clear();
		_meta = "";
		_queue = new BlockingCollection<byte[]>(boundedCapacity: 180);
		string rawPath = Path.Combine(dir, "frames.raw");
		var q = _queue;
		_writer = new Thread(() =>
		{
			using var fs = new FileStream(rawPath, FileMode.Create, System.IO.FileAccess.Write, FileShare.Read, 1 << 22);
			foreach (var buf in q.GetConsumingEnumerable()) fs.Write(buf, 0, buf.Length);
		}) { IsBackground = true, Name = "RecolorRecorderWriter" };
		_writer.Start();
		ModEntry.Log($"record: {key} → {dir}, {_total} frames at {fps} fps");
	}

	public static void Tick()
	{
		if (_vp == null) return;
		try
		{
			if (_warm > 0) { _warm--; return; }
			var img = _vp.GetTexture().GetImage();
			if (_meta.Length == 0)
				_meta = $"width={img.GetWidth()}\nheight={img.GetHeight()}\nformat={img.GetFormat()}\n";
			_ticks.Add(Time.GetTicksUsec());
			_queue!.Add(img.GetData());
			_frame++;
			if (_frame >= _total) Finish();
		}
		catch (Exception ex)
		{
			ModEntry.Log("record failed: " + ex.Message);
			Finish();
		}
	}

	private static void Finish()
	{
		try { _queue?.CompleteAdding(); _writer?.Join(); } catch (Exception ex) { ModEntry.Log("record save error: " + ex.Message); }
		_queue = null; _writer = null;
		double secs = _ticks.Count > 1 ? (_ticks[^1] - _ticks[0]) / 1_000_000.0 : 0;
		double fps = secs > 0 ? (_ticks.Count - 1) / secs : 0;
		File.WriteAllText(Path.Combine(_dir, "timing.txt"), $"frames={_ticks.Count}\nseconds={secs:0.000}\nfps={fps:0.00}\n" + _meta);
		if (_vp != null && GodotObject.IsInstanceValid(_vp)) _vp.QueueFree();
		_vp = null;
		Engine.MaxFps = _prevMaxFps;
		ModEntry.Log($"record done: {_ticks.Count} frames, measured {fps:0.0} fps → {_dir}");
	}

	public static void ExportTexture(string resPath, string outPng)
	{
		var tex = ResourceLoader.Load<Texture2D>(resPath) ?? throw new ArgumentException("can't load " + resPath);
		var img = tex.GetImage() ?? throw new InvalidOperationException("no image data for " + resPath);
		if (img.IsCompressed()) img.Decompress();
		Directory.CreateDirectory(Path.GetDirectoryName(outPng)!);
		img.SavePng(outPng);
		ModEntry.Log($"exporttex: {resPath} → {outPng} ({img.GetWidth()}x{img.GetHeight()})");
	}
}
