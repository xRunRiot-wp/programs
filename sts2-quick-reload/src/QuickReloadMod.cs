using System;
using System.Threading.Tasks;
using Godot;
using MegaCrit.Sts2.Core.Helpers;
using MegaCrit.Sts2.Core.Modding;
using MegaCrit.Sts2.Core.Multiplayer.Game;
using MegaCrit.Sts2.Core.Nodes;
using MegaCrit.Sts2.Core.Nodes.Audio;
using MegaCrit.Sts2.Core.Nodes.Screens.MainMenu;
using MegaCrit.Sts2.Core.Nodes.Vfx;
using MegaCrit.Sts2.Core.Platform;
using MegaCrit.Sts2.Core.Platform.Steam;
using MegaCrit.Sts2.Core.Runs;
using MegaCrit.Sts2.Core.Saves;

namespace STS2_QuickReload;

// F5 = reload the co-op save and wait for friends (Joseph, 2026-09-27: "when im playing multiplayer
// slay the spire 2, when i hit f5 i reload the save file waiting for my friends").
//
// In a multiplayer run you host, F5 does exactly what the pause menu's Save & Quit does (the game
// autosaves; Save & Quit just returns to the menu), then does what Multiplayer > Load does: reads the
// co-op save and opens the host load lobby, where friends rejoin. On the main menu, F5 just does the
// load part. Clients can't reload a host's run, so for them it only shows a note.
[ModInitializer("Initialize")]
public static class QuickReloadMod
{
    private static Key _key = Key.F5;
    private static bool _downLast, _busy;

    public static void Initialize()
    {
        try
        {
            var tree = (SceneTree)Engine.GetMainLoop();
            tree.Connect(SceneTree.SignalName.ProcessFrame, Callable.From(Tick));
            GD.Print("[Quick Reload] initialized (F5)");
        }
        catch (Exception ex) { GD.PrintErr($"[Quick Reload] init failed: {ex.Message}"); }
    }

    private static void Tick()
    {
        try
        {
            bool down = Input.IsPhysicalKeyPressed(_key);
            if (down && !_downLast && !_busy && !Typing())
                TaskHelper.RunSafely(Reload());
            _downLast = down;
        }
        catch { }
    }

    // Don't fire while typing in a text box (the Claude chat, the dev console).
    private static bool Typing()
    {
        try
        {
            var f = ((SceneTree)Engine.GetMainLoop()).Root.GuiGetFocusOwner();
            return f is LineEdit || f is TextEdit;
        }
        catch { return false; }
    }

    private static void Note(string text)
    {
        try
        {
            var vfx = NFullscreenTextVfx.Create(text);
            if (vfx != null) NGame.Instance.AddChildSafely(vfx);
        }
        catch { }
        GD.Print($"[Quick Reload] {text}");
    }

    private static async Task NextFrame()
    {
        var tree = (SceneTree)Engine.GetMainLoop();
        await tree.ToSignal(tree, SceneTree.SignalName.ProcessFrame);
    }

    private static async Task Reload()
    {
        _busy = true;
        try
        {
            var rm = RunManager.Instance;
            if (rm.IsInProgress)
            {
                var type = rm.NetService?.Type;
                if (type == NetGameType.Client) { Note("Only the host can reload the co-op save"); return; }
                if (type != NetGameType.Host) return; // single-player: leave F5 alone
                Note("Reloading co-op save…");
                // Same steps as the pause menu's Save & Quit.
                try { NRunMusicController.Instance?.StopMusic(); } catch { }
                await NGame.Instance.ReturnToMainMenu();
            }

            // Wait for the main menu to be up and ready.
            NMainMenu? menu = null;
            for (int i = 0; i < 900; i++)
            {
                menu = NGame.Instance.MainMenu;
                if (menu != null && menu.IsNodeReady() && menu.SubmenuStack != null) break;
                await NextFrame();
            }
            if (menu == null) { Note("Couldn't reach the main menu"); return; }
            for (int i = 0; i < 10; i++) await NextFrame();

            // Same steps as Multiplayer > Load.
            var platform = (SteamInitializer.Initialized && !CommandLineHelper.HasArg("fastmp")) ? PlatformType.Steam : PlatformType.None;
            var save = SaveManager.Instance.LoadAndCanonicalizeMultiplayerRunSave(PlatformUtil.GetLocalPlayerId(platform));
            if (!save.Success || save.SaveData == null) { Note("No co-op save to load"); return; }
            var mp = menu.SubmenuStack.PushSubmenuType<NMultiplayerSubmenu>();
            mp.StartHost(save.SaveData);
            GD.Print("[Quick Reload] load lobby opened, waiting for friends");
        }
        catch (Exception ex)
        {
            GD.PrintErr($"[Quick Reload] failed: {ex}");
            Note("Quick reload failed; use Save & Quit");
        }
        finally { _busy = false; }
    }
}
