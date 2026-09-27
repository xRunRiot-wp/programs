using System;
using System.Collections.Generic;
using Godot;
using MegaCrit.Sts2.Core.Combat;
using MegaCrit.Sts2.Core.Entities.Creatures;
using MegaCrit.Sts2.Core.Entities.Powers;
using MegaCrit.Sts2.Core.Models;
using MegaCrit.Sts2.Core.Models.Powers;

namespace STS2_DamageCharts;

// Which damage-over-time a dealt hit came from. Poison/Doom get their own dedicated section in every
// view (totals, share of damage, ticks, kills) on top of appearing as rows in the by-source list.
internal enum DotKind { None, Poison, Doom }

// Per-player Doom & Poison totals for one scope (a combat, or the whole run).
internal sealed class DotTotals
{
    public long PoisonTotal;
    public int PoisonTicks;
    public int PoisonMaxTick;
    public int PoisonKills;
    public long DoomTotal;   // HP removed by Doom kills (Doom executes; its "damage" is the HP it took)
    public int DoomKills;

    public long Total => PoisonTotal + DoomTotal;
    public bool HasData => PoisonTotal > 0 || DoomTotal > 0;

    public DotTotals Clone() => (DotTotals)MemberwiseClone();

    public void Add(DotTotals o)
    {
        PoisonTotal += o.PoisonTotal;
        PoisonTicks += o.PoisonTicks;
        PoisonMaxTick = Math.Max(PoisonMaxTick, o.PoisonMaxTick);
        PoisonKills += o.PoisonKills;
        DoomTotal += o.DoomTotal;
        DoomKills += o.DoomKills;
    }
}

// One debuff currently on an enemy.
internal readonly struct DebuffInfo
{
    public readonly string Name;
    public readonly int Amount;
    public readonly string? Icon;
    public DebuffInfo(string name, int amount, string? icon) { Name = name; Amount = amount; Icon = icon; }
}

// Live state of one enemy: HP, every debuff on it, and what its Poison/Doom will do.
internal sealed class EnemyStatus
{
    public string Name = "";
    public int Hp, MaxHp;
    public List<DebuffInfo> Debuffs = new();
    public int Poison;          // poison stacks
    public int PoisonNextTurn;  // damage the poison will deal at its next tick (game's own calculation)
    public int Doom;            // doom stacks
    public bool Doomed;         // HP <= Doom → dies to Doom at end of its turn
}

// Everything the HUD needs about Doom/Poison and enemy debuffs, rebuilt a few times per second.
internal sealed class DotHud
{
    public DotTotals Dots = new();
    public long DealtTotal;
    public List<EnemyStatus> Enemies = new();

    public int PoisonOnEnemies, PoisonNextTurn, DoomOnEnemies, DoomedCount, DebuffCount;
}

internal static class DotReader
{
    public static readonly Color PoisonColor = new(0.80f, 0.94f, 0.20f); // lime: distinct from the Silent's emerald
    public static readonly Color DoomColor = new(0.74f, 0.50f, 0.98f);

    private static string? _poisonIcon, _doomIcon;
    private static string _poisonName = "Poison", _doomName = "Doom";
    private static bool _iconsResolved;

    public static string? PoisonIcon { get { ResolveIcons(); return _poisonIcon; } }
    public static string? DoomIcon { get { ResolveIcons(); return _doomIcon; } }
    public static string PoisonName { get { ResolveIcons(); return _poisonName; } }
    public static string DoomName { get { ResolveIcons(); return _doomName; } }

    // The by-source lists key on the (localized) label, so the views recognize Poison/Doom rows by name.
    public static DotKind KindOf(string sourceName)
        => sourceName == PoisonName ? DotKind.Poison : sourceName == DoomName ? DotKind.Doom : DotKind.None;

    public static string? IconOf(DotKind k) => k == DotKind.Poison ? PoisonIcon : k == DotKind.Doom ? DoomIcon : null;

    public static Color ColorOf(DotKind k, Color fallback) => k == DotKind.Poison ? PoisonColor : k == DotKind.Doom ? DoomColor : fallback;

    private static void ResolveIcons()
    {
        if (_iconsResolved) return;
        try
        {
            var pp = ModelDb.Power<PoisonPower>();
            var dp = ModelDb.Power<DoomPower>();
            _iconsResolved = true;
            try { var p = pp.PackedIconPath; if (ResourceLoader.Exists(p)) _poisonIcon = p; } catch { }
            try { var p = dp.PackedIconPath; if (ResourceLoader.Exists(p)) _doomIcon = p; } catch { }
            _poisonName = TextHelper.SafeGetText(() => pp.Title) ?? _poisonName;
            _doomName = TextHelper.SafeGetText(() => dp.Title) ?? _doomName;
        }
        catch { /* ModelDb not ready yet — retry next call */ }
    }

    // Read-only snapshot of every living enemy's debuffs. Never mutates game state.
    public static void ReadEnemies(CombatState cs, DotHud hud)
    {
        hud.Enemies.Clear();
        hud.PoisonOnEnemies = hud.PoisonNextTurn = hud.DoomOnEnemies = hud.DoomedCount = hud.DebuffCount = 0;
        List<Creature> enemies;
        try { enemies = new List<Creature>(cs.Enemies); } catch { return; }
        foreach (var e in enemies)
        {
            try
            {
                if (e == null || !e.IsAlive) continue;
                var st = new EnemyStatus
                {
                    Name = TextHelper.SafeGetText(() => e.Monster!.Title) ?? "Enemy",
                    Hp = e.CurrentHp,
                    MaxHp = e.MaxHp,
                };
                foreach (var p in new List<PowerModel>(e.Powers))
                {
                    try
                    {
                        if (p.TypeForCurrentAmount != PowerType.Debuff) continue;
                        string name = TextHelper.SafeGetText(() => p.Title) ?? p.GetType().Name;
                        string? icon = null;
                        try { var ip = p.PackedIconPath; if (ResourceLoader.Exists(ip)) icon = ip; } catch { }
                        st.Debuffs.Add(new DebuffInfo(name, p.DisplayAmount, icon));
                        if (p is PoisonPower pp)
                        {
                            st.Poison = pp.Amount;
                            try { st.PoisonNextTurn = pp.CalculateTotalDamageNextTurn(); } catch { st.PoisonNextTurn = pp.Amount; }
                        }
                        else if (p is DoomPower)
                        {
                            st.Doom = p.Amount;
                            st.Doomed = e.CurrentHp <= p.Amount;
                        }
                    }
                    catch { }
                }
                hud.Enemies.Add(st);
                hud.PoisonOnEnemies += st.Poison;
                hud.PoisonNextTurn += Math.Min(st.PoisonNextTurn, st.Hp);
                hud.DoomOnEnemies += st.Doom;
                if (st.Doomed) hud.DoomedCount++;
                hud.DebuffCount += st.Debuffs.Count;
            }
            catch { }
        }
    }

    public static int Pct(long part, long whole) => whole > 0 ? (int)Math.Round(100.0 * part / whole) : 0;
}
