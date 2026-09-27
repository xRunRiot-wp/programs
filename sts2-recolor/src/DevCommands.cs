using System;
using System.IO;
using Godot;

namespace SpireRecolor;

/// <summary>
/// Test hook: if a file named "rc_cmd.txt" appears in the mod folder, run its lines and delete it.
/// Lets the mod be exercised without keyboard/mouse input. Does nothing unless that file exists.
///   open | close | select &lt;key&gt; | set &lt;key&gt; &lt;field&gt; &lt;value&gt; | swap &lt;key&gt; &lt;#from&gt; &lt;#to&gt; &lt;range&gt; | clear &lt;key&gt; | shot &lt;png path&gt;
/// </summary>
internal static class DevCommands
{
	private static int _frame;
	private static string _cmdPath = "";

	public static void Init(string modDir) => _cmdPath = Path.Combine(modDir, "rc_cmd.txt");

	public static void Tick()
	{
		if (++_frame % 20 != 0 || _cmdPath.Length == 0 || !File.Exists(_cmdPath))
			return;
		string[] lines;
		try
		{
			lines = File.ReadAllLines(_cmdPath);
			File.Delete(_cmdPath);
		}
		catch
		{
			return;
		}
		foreach (string raw in lines)
		{
			string line = raw.Trim();
			if (line.Length == 0)
				continue;
			try
			{
				Run(line.Split(' ', StringSplitOptions.RemoveEmptyEntries));
				ModEntry.Log("dev cmd ok: " + line);
			}
			catch (Exception ex)
			{
				ModEntry.Log($"dev cmd failed: {line} -> {ex.Message}");
			}
		}
	}

	private static void Run(string[] a)
	{
		switch (a[0])
		{
			case "open":
				if (!EditorUi.IsOpen) EditorUi.Toggle();
				break;
			case "close":
				if (EditorUi.IsOpen) EditorUi.Toggle();
				break;
			case "select":
				EditorUi.SelectByKey(a[1]);
				break;
			case "set":
			{
				var t = Palette.GetOrCreate(a[1]);
				float f = a[3].StartsWith("#") ? 0 : float.Parse(a[3], System.Globalization.CultureInfo.InvariantCulture);
				switch (a[2])
				{
					case "hue": t.Hue = f; break;
					case "saturation": t.Saturation = f; break;
					case "brightness": t.Brightness = f; break;
					case "contrast": t.Contrast = f; break;
					case "tint": t.Tint = a[3]; break;
					case "tintStrength": t.TintStrength = f; break;
					case "enabled": t.Enabled = f != 0; break;
				}
				Palette.Touch();
				Palette.Save();
				EditorUi.Reload();
				break;
			}
			case "swap":
				Palette.GetOrCreate(a[1]).Swaps.Add(new ColorSwap { From = a[2], To = a[3], Range = float.Parse(a[4], System.Globalization.CultureInfo.InvariantCulture) });
				Palette.Touch();
				Palette.Save();
				EditorUi.Reload();
				break;
			case "clear":
				Palette.Remove(a[1]);
				Palette.Save();
				EditorUi.Reload();
				break;
			case "shot":
			{
				var tree = (SceneTree)Engine.GetMainLoop();
				tree.Root.GetTexture().GetImage().SavePng(string.Join(' ', a, 1, a.Length - 1));
				break;
			}
			case "pick":
				EditorUi.DevPick(int.Parse(a[1]), float.Parse(a[2]), float.Parse(a[3]));
				break;
			case "part":
				EditorUi.SelectPart(a.Length > 1 ? string.Join(' ', a, 1, a.Length - 1) : null);
				break;
			case "parts":
				ModEntry.Log("parts: " + string.Join(", ", EditorUi.PartNames));
				break;
			case "ui":
				EditorUi.DevSlider(a[1], double.Parse(a[2], System.Globalization.CultureInfo.InvariantCulture));
				break;
			case "mexport":
				ModEntry.Log("exported parts: " + EditorUi.DevExport());
				break;
			case "mreload":
				Palette.Touch();
				EditorUi.Reload();
				break;
			case "mpack":
				ModEntry.Log("pack: " + ModelSwap.MakeSharePack());
				break;
			case "mload":
				ModEntry.Log("load: " + (ModelSwap.ImportIncoming() ?? "nothing"));
				break;
			case "selectat":
				EditorUi.DevSelectAt(float.Parse(a[1], System.Globalization.CultureInfo.InvariantCulture), float.Parse(a[2], System.Globalization.CultureInfo.InvariantCulture));
				break;
			case "picktint":
				EditorUi.DevPickTint(float.Parse(a[1], System.Globalization.CultureInfo.InvariantCulture), float.Parse(a[2], System.Globalization.CultureInfo.InvariantCulture));
				break;
			case "selectdebug":
				EditorUi.SelectDebug = true;
				break;
			case "curpart":
				ModEntry.Log("current part: " + (EditorUi.CurrentPart ?? "whole body"));
				break;
			case "picture":
				EditorUi.SetPicture(string.Join(' ', a, 1, a.Length - 1));
				break;
			case "picmode":
				EditorUi.DevPictureMode(a[1]);
				break;
			case "inspect":
				EditorUi.DevInspect();
				break;
			case "status":
				ModEntry.Log("status: " + EditorUi.Status);
				break;
			case "dump":
				ModEntry.Log("palette: " + File.ReadAllText(Palette.FilePath).Replace("\n", " "));
				break;
			case "export":
				File.WriteAllText(string.Join(' ', a, 1, a.Length - 1), Palette.ExportShareCode());
				break;
			case "import":
				Palette.ImportShareCode(File.ReadAllText(string.Join(' ', a, 1, a.Length - 1)));
				EditorUi.Reload();
				break;
		}
	}
}
