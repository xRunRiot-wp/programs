using System;
using System.IO;
using Godot;
using HarmonyLib;
using MegaCrit.Sts2.Core.Modding;
using MegaCrit.Sts2.Core.Models;
using MegaCrit.Sts2.Core.Nodes.Combat;

namespace SpireRecolor;

[ModInitializer("Init")]
public static class ModEntry
{
	public const string ModId = "sts2_recolor";
	private static readonly Harmony Harmony = new("mod." + ModId);
	private static bool _hooked;
	public static string ModDir { get; private set; } = ".";
	private static bool _f8WasDown;
	private static int _seenRevision = -1;

	public static void Init()
	{
		try
		{
			string modDir = Path.GetDirectoryName(typeof(ModEntry).Assembly.Location) ?? ".";
			ModDir = modDir;
			Palette.Init(modDir);
			DevCommands.Init(modDir);
			try
			{
				string? imported = ModelSwap.ImportIncoming();
				if (imported != null)
					Log(imported);
			}
			catch (Exception ex)
			{
				Log($"Share pack import failed: {ex.Message}");
			}
			Harmony.PatchAll(typeof(ModEntry).Assembly);
			TryHookTree();
			Log("Initialized. Press F8 in game to open the recolor palette.");
		}
		catch (Exception ex)
		{
			Log($"Init failed: {ex}");
		}
	}

	private static void TryHookTree()
	{
		if (_hooked)
			return;
		if (Engine.GetMainLoop() is not SceneTree tree)
			return;
		tree.NodeAdded += Recolorer.OnNodeAdded;
		tree.ProcessFrame += OnProcessFrame;
		_hooked = true;
	}

	private static void OnProcessFrame()
	{
		try
		{
			bool down = Input.IsPhysicalKeyPressed(Key.F8);
			if (down && !_f8WasDown)
				EditorUi.Toggle();
			_f8WasDown = down;

			if (_seenRevision != Palette.Revision)
			{
				_seenRevision = Palette.Revision;
				Recolorer.RefreshAll();
			}
			EditorUi.Tick();
			DevCommands.Tick();
			EffectRecolor.Tick();
		}
		catch (Exception ex)
		{
			Log($"Frame hook error: {ex}");
		}
	}

	public static void Log(string msg)
	{
		try { MegaCrit.Sts2.Core.Logging.Log.Info("[SpireRecolor] " + msg); }
		catch { GD.Print("[SpireRecolor] " + msg); }
	}
}

/// <summary>Tags each creature's visuals with its model id so the recolorer knows whose palette to use.</summary>
[HarmonyPatch(typeof(CharacterModel), nameof(CharacterModel.CreateVisuals))]
internal static class CharacterVisualsPatch
{
	private static void Postfix(CharacterModel __instance, NCreatureVisuals __result)
	{
		__result?.SetMeta(Recolorer.KeyMeta, __instance.Id.Entry.ToLowerInvariant());
	}
}

[HarmonyPatch(typeof(MonsterModel), nameof(MonsterModel.CreateVisuals))]
internal static class MonsterVisualsPatch
{
	private static bool _logged;

	private static void Postfix(MonsterModel __instance, NCreatureVisuals __result)
	{
		__result?.SetMeta(Recolorer.KeyMeta, __instance.Id.Entry.ToLowerInvariant());
		if (!_logged)
		{
			_logged = true;
			ModEntry.Log($"Visuals hook active (first tagged: {__instance.Id.Entry})");
		}
	}
}
