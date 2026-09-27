using System;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using Godot;
using MegaCrit.Sts2.Core.Commands;
using MegaCrit.Sts2.Core.Context;
using MegaCrit.Sts2.Core.DevConsole;
using MegaCrit.Sts2.Core.Models;
using MegaCrit.Sts2.Core.Nodes;
using MegaCrit.Sts2.Core.Runs;

namespace STS2_DamageCharts;

// Headless test hook (no keyboard/mouse needed): drop a dc_cmd.txt next to the DLL, one command per
// line. The file is consumed; results go to dc_out.txt and the Godot log. Harmless when the file is absent.
//   newrun <CHARACTER>     start a throwaway single-player run (not saved), e.g. newrun SILENT
//   con <console command>  run a dev-console command, e.g. con fight <ENCOUNTER>, con power POISON_POWER 12 1
//   endturn                end the local player's turn (lets Poison tick / Doom execute)
//   mode <MeterMode>       DamageDone | PerTurn | Taken | DoomPoison | Debuffs
//   seg run|fight          meter segment while in combat
//   hover <row>            force the meter tooltip for a row (-1 = real mouse)
//   detail on|off          full-screen breakdown
//   shot <png path>        save a screenshot of the game viewport
//   state                  dump tracker / meter / debuff state
//   ids <prefix>           list model ids (encounters, powers, characters) containing <prefix>
public static partial class DamageChartsMod
{
    private static DevConsole? _devConsole;

    private static void PollDebugCommands()
    {
        string? dir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
        if (dir == null) return;
        string cmdPath = Path.Combine(dir, "dc_cmd.txt");
        if (!File.Exists(cmdPath)) return;
        // Never in co-op: dev-console commands would be sent to the other players.
        try { if (RunManager.Instance.IsInProgress && !RunManager.Instance.IsSingleplayerOrFakeMultiplayer) return; } catch { return; }
        string[] lines;
        try { lines = File.ReadAllLines(cmdPath); File.Delete(cmdPath); } catch { return; }
        var outp = new StringBuilder();
        foreach (var raw in lines)
        {
            string line = raw.Trim();
            if (line.Length == 0 || line.StartsWith("#")) continue;
            string res;
            try { res = RunDebugCommand(line); }
            catch (Exception ex) { res = $"ERROR {ex.GetType().Name}: {ex.Message}"; }
            outp.AppendLine($"> {line}\n{res}");
            GD.Print($"[STS2 Damage][test] {line} -> {res}");
        }
        try { File.AppendAllText(Path.Combine(dir, "dc_out.txt"), outp.ToString()); } catch { }
    }

    private static string RunDebugCommand(string line)
    {
        int sp = line.IndexOf(' ');
        string cmd = (sp < 0 ? line : line[..sp]).ToLowerInvariant();
        string arg = sp < 0 ? "" : line[(sp + 1)..].Trim();
        switch (cmd)
        {
            case "newrun":
            {
                var ch = ModelDb.AllCharacters.FirstOrDefault(c => c.Id.Entry.Equals(arg, StringComparison.OrdinalIgnoreCase))
                         ?? ModelDb.AllCharacters.First();
                _ = NGame.Instance.StartNewSingleplayerRun(ch, false, ActModel.GetDefaultList(),
                        Array.Empty<ModifierModel>(), "DCTEST", GameMode.Standard);
                return $"starting run as {ch.Id.Entry}";
            }
            case "con":
            {
                _devConsole ??= new DevConsole(true);
                var r = _devConsole.ProcessCommand(arg);
                return $"{(r.success ? "ok" : "FAIL")}: {r.msg}";
            }
            case "endturn":
            {
                var rs = SafeRunState();
                var me = rs != null ? LocalContext.GetMe(rs) : null;
                if (me == null) return "no local player";
                PlayerCmd.EndTurn(me, false);
                return "turn ended";
            }
            case "mode":
                if (_meter != null && Enum.TryParse<MeterMode>(arg, true, out var m)) { _meter.Mode = m; _meterMode = m; return $"mode {m}"; }
                return "no meter / bad mode";
            case "seg":
                if (_meter == null) return "no meter";
                _meter.RunSegmentChosen = arg.Equals("run", StringComparison.OrdinalIgnoreCase);
                return $"segment run={_meter.RunSegmentChosen}";
            case "hover":
                if (_meter == null) return "no meter";
                _meter.DebugHoverRow = int.TryParse(arg, out int hr) ? hr : -1;
                return $"hover row {_meter.DebugHoverRow}";
            case "detail":
                _detailVisible = arg != "off";
                _detail?.SetVisible(_detailVisible);
                return $"detail {_detailVisible}";
            case "shot":
            {
                var img = ((SceneTree)Engine.GetMainLoop()).Root.GetViewport().GetTexture().GetImage();
                var err = img.SavePng(arg);
                return $"shot {arg} {err} {img.GetWidth()}x{img.GetHeight()}";
            }
            case "ids":
            {
                var ids = ModelDb.All.Select(x => x.Id.Entry).Where(x => x.Contains(arg, StringComparison.OrdinalIgnoreCase)).Distinct().Take(60);
                return string.Join(" ", ids);
            }
            case "state":
            {
                var sb = new StringBuilder();
                var snap = _tracker.SourceSnapshot();
                sb.Append($"inCombat={SafeIsInCombat()} run={SafeIsRunInProgress()} runFights={(_run.HasData() ? _run.EncounterStats(_localSlot).Count : 0)} rounds={snap.Rounds}\n");
                for (int s = 0; s < snap.PerPlayer.Length; s++)
                {
                    var p = snap.PerPlayer[s];
                    sb.Append($"P{s} dealt={p.DealtTotal} taken={p.TakenTotal} poison={p.Dots.PoisonTotal}/{p.Dots.PoisonTicks}t/{p.Dots.PoisonKills}k doom={p.Dots.DoomTotal}/{p.Dots.DoomKills}k\n");
                    foreach (var e in p.Dealt) sb.Append($"   dealt  {e.Name}={e.Total} hits={e.Hits} max={e.MaxHit}\n");
                    foreach (var e in p.Taken) sb.Append($"   taken  {e.Name}={e.Total} hits={e.Hits}\n");
                }
                foreach (var en in _hud.Enemies)
                    sb.Append($"enemy {en.Name} {en.Hp}/{en.MaxHp} debuffs=[{string.Join(", ", en.Debuffs.Select(d => $"{d.Name} {d.Amount}"))}] poisonNext={en.PoisonNextTurn} doomed={en.Doomed}\n");
                sb.Append($"meter mode={_meter?.Mode} visible={_meter?.IsShown}");
                return sb.ToString();
            }
        }
        return "unknown command";
    }
}
