using System;
using System.Collections.Generic;
using Godot;

namespace STS2_DamageCharts;

// The meter's display modes, cycled with the ◀ ▶ arrows (or a click on the title), Details!-style.
internal enum MeterMode { DamageDone, PerTurn, Taken, Blocked, Differential, DoomPoison, Debuffs }

// Hover tooltip content: a title plus icon / left text / right-aligned value lines.
internal sealed class MeterTip
{
    public string Title = "";
    public Color TitleColor = UiTheme.Gold;
    public readonly List<(string? Icon, string Left, string Right, Color Color)> Lines = new();
    public MeterTip Add(string left, string right, Color? color = null, string? icon = null)
    { Lines.Add((icon, left, right, color ?? UiTheme.Cream)); return this; }
}

internal sealed class MeterRow
{
    public string Name = "";
    public string Right = "";
    public double Value;
    public Color Color;
    public string? Icon;
    public MeterTip? Tip;
    public bool Sub;      // indented detail row (e.g. per-enemy poison under the Poison row)
    public bool Pinned;   // always kept on screen (Poison / Doom in Damage Done)
    public Color? NameColor; // player rows: gold, like the game's player panel
    public List<(double Value, Color Color)>? Segs; // stacked parts of the bar (e.g. direct / Poison / Doom)
}

internal sealed class MeterInput
{
    public SourceSnapshot Snap = null!;
    public DotHud? Hud;           // live enemy state (in combat only)
    public bool InCombat;
    public bool RunSegment;       // showing whole-run numbers
    public bool CanToggleSegment; // Fight/Run button active (in combat and right after a fight)
    public Color[] Palette = UiTheme.Players;
}

// Builds the rows for each mode from the tracker snapshots. Pure data; no Godot nodes.
internal static class MeterRows
{
    public static string ModeName(MeterMode m) => m switch
    {
        MeterMode.DamageDone => "Damage Done",
        MeterMode.PerTurn => "DPS (per turn)",
        MeterMode.Taken => "Damage Taken",
        MeterMode.Blocked => "Damage Blocked",
        MeterMode.Differential => "Differential",
        MeterMode.DoomPoison => "Doom & Poison",
        _ => "Enemy Debuffs",
    };

    public static string Fmt(double v)
    {
        double a = Math.Abs(v);
        if (a >= 1_000_000) return (v / 1_000_000).ToString("0.0") + "M";
        if (a >= 10_000) return (v / 1_000).ToString("0.0") + "K";
        return ((long)Math.Round(v)).ToString();
    }

    internal static string Rate(double v) => v >= 100 ? Fmt(v) : v.ToString("0.0");

    // Damage differential: Ratio = dealt ÷ taken (HP lost), Net = dealt − taken.
    public static string Ratio(long dealt, long taken)
        => taken <= 0 ? (dealt > 0 ? "∞ : 1" : "—") : (dealt / (double)taken).ToString(dealt / (double)taken >= 10 ? "0" : "0.0") + " : 1";
    public static string Net(long v) => (v >= 0 ? "+" : "−") + Fmt(Math.Abs(v));
    private static readonly Color BlockBlue = new(0.50f, 0.72f, 0.96f), HealGreen = new(0.45f, 0.85f, 0.45f);

    public static List<MeterRow> Build(MeterMode mode, MeterInput inp, out string strip)
    {
        var snap = inp.Snap;
        int slot = Math.Clamp(snap.LocalSlot, 0, Math.Max(0, snap.PlayerCount - 1));
        var ps = slot < snap.PerPlayer.Length ? snap.PerPlayer[slot] : new PlayerSources();
        int turns = Math.Max(1, snap.Rounds);
        var me = inp.Palette[Math.Min(slot, inp.Palette.Length - 1)];
        var rows = new List<MeterRow>();
        string scope = inp.RunSegment ? "run" : "fight";

        switch (mode)
        {
            case MeterMode.DamageDone:
            case MeterMode.PerTurn:
            {
                bool perTurn = mode == MeterMode.PerTurn;
                strip = $"Total {Fmt(ps.DealtTotal)}  ·  {Rate(ps.DealtTotal / (double)turns)} per turn  ·  {turns} turn{(turns == 1 ? "" : "s")}";
                if (snap.PlayerCount > 1)
                {
                    long all = 0;
                    foreach (var p in snap.PerPlayer) all += p.DealtTotal;
                    for (int s = 0; s < snap.PlayerCount; s++)
                    {
                        var p = snap.PerPlayer[s];
                        double pt = p.DealtTotal / (double)turns;
                        rows.Add(new MeterRow
                        {
                            Name = s < snap.Labels.Length ? snap.Labels[s] : $"P{s + 1}",
                            Icon = s < snap.PlayerIcons.Length ? snap.PlayerIcons[s] : null,
                            NameColor = UiTheme.Gold,
                            Segs = new()
                            {
                                (Math.Max(0, p.DealtTotal - p.Dots.Total), inp.Palette[Math.Min(s, inp.Palette.Length - 1)]),
                                (p.Dots.PoisonTotal, DotReader.PoisonColor),
                                (p.Dots.DoomTotal, DotReader.DoomColor),
                            },
                            Value = perTurn ? pt : p.DealtTotal,
                            Right = perTurn ? $"{Rate(pt)}/turn ({Fmt(p.DealtTotal)})" : $"{Fmt(p.DealtTotal)} ({Rate(pt)}, {DotReader.Pct(p.DealtTotal, all)}%)",
                            Color = inp.Palette[Math.Min(s, inp.Palette.Length - 1)],
                            Tip = PlayerTip(snap.Labels.Length > s ? snap.Labels[s] : $"P{s + 1}", p, turns),
                        });
                    }
                }
                else
                {
                    var dealtList = new List<SourceEntry>(ps.Dealt);
                    if (!dealtList.Exists(x => x.Name == DotReader.PoisonName)) dealtList.Add(new SourceEntry(DotReader.PoisonName, 0, DotReader.PoisonIcon));
                    if (!dealtList.Exists(x => x.Name == DotReader.DoomName)) dealtList.Add(new SourceEntry(DotReader.DoomName, 0, DotReader.DoomIcon));
                    foreach (var e in dealtList)
                    {
                        var kind = DotReader.KindOf(e.Name);
                        double pt = e.Total / (double)turns;
                        rows.Add(new MeterRow
                        {
                            Name = e.Name,
                            Icon = e.Icon ?? DotReader.IconOf(kind),
                            Value = perTurn ? pt : e.Total,
                            Right = perTurn ? $"{Rate(pt)}/turn ({Fmt(e.Total)})" : $"{Fmt(e.Total)} ({Rate(pt)}, {DotReader.Pct(e.Total, ps.DealtTotal)}%)",
                            Color = DotReader.ColorOf(kind, me),
                            Pinned = kind != DotKind.None,
                            Tip = SourceTip(e, ps.DealtTotal, turns, kind, ps.Dots, inp.Hud),
                        });
                    }
                }
                break;
            }

            case MeterMode.Taken:
                strip = $"Taken {Fmt(ps.TakenTotal)}  ·  Healed {Fmt(ps.HealTotal)}  ·  Block {Fmt(ps.BlockTotal)}";
                foreach (var e in ps.Taken)
                {
                    rows.Add(new MeterRow
                    {
                        Name = e.Name,
                        Icon = e.Icon,
                        Value = e.Total,
                        Right = $"{Fmt(e.Total)} ({Rate(e.Total / (double)turns)}, {DotReader.Pct(e.Total, ps.TakenTotal)}%)",
                        Color = UiTheme.Red,
                        Tip = SourceTip(e, ps.TakenTotal, turns, DotKind.None, null, null, taken: true),
                    });
                }
                break;

            case MeterMode.Blocked:
            {
                long incoming = ps.BlockedTotal + ps.TakenTotal;
                strip = $"Blocked {Fmt(ps.BlockedTotal)} of {Fmt(incoming)} incoming ({DotReader.Pct(ps.BlockedTotal, incoming)}%)";
                if (snap.PlayerCount > 1)
                {
                    for (int s = 0; s < snap.PlayerCount; s++)
                    {
                        var p = snap.PerPlayer[s];
                        long inc = p.BlockedTotal + p.TakenTotal;
                        rows.Add(new MeterRow
                        {
                            Name = s < snap.Labels.Length ? snap.Labels[s] : $"P{s + 1}",
                            Icon = s < snap.PlayerIcons.Length ? snap.PlayerIcons[s] : null, NameColor = UiTheme.Gold,
                            Value = p.BlockedTotal,
                            Right = $"{Fmt(p.BlockedTotal)} ({DotReader.Pct(p.BlockedTotal, inc)}% stopped)",
                            Color = inp.Palette[Math.Min(s, inp.Palette.Length - 1)],
                            Tip = DefenseTip(s < snap.Labels.Length ? snap.Labels[s] : "", p, turns),
                        });
                    }
                    break;
                }
                var tip = DefenseTip("Defense", ps, turns);
                rows.Add(new MeterRow { Name = "Damage blocked", Value = ps.BlockedTotal, Color = BlockBlue, Tip = tip,
                    Right = $"{Fmt(ps.BlockedTotal)} ({DotReader.Pct(ps.BlockedTotal, incoming)}% of incoming)" });
                rows.Add(new MeterRow { Name = "Block gained", Value = ps.BlockTotal, Color = new Color(0.36f, 0.52f, 0.78f), Tip = tip,
                    Right = $"{Fmt(ps.BlockTotal)} ({DotReader.Pct(ps.BlockedTotal, ps.BlockTotal)}% used)" });
                rows.Add(new MeterRow { Name = "HP lost", Value = ps.TakenTotal, Color = UiTheme.Red, Tip = tip,
                    Right = $"{Fmt(ps.TakenTotal)} ({DotReader.Pct(ps.TakenTotal, incoming)}% of incoming)" });
                rows.Add(new MeterRow { Name = "Healed", Value = ps.HealTotal, Color = HealGreen, Tip = tip, Right = Fmt(ps.HealTotal) });
                return rows; // fixed order
            }

            case MeterMode.Differential:
            {
                long net = ps.DealtTotal - ps.TakenTotal;
                strip = $"Ratio {Ratio(ps.DealtTotal, ps.TakenTotal)}  ·  Net {Net(net)}  (dealt ÷ taken, dealt − taken)";
                if (snap.PlayerCount > 1)
                {
                    for (int s = 0; s < snap.PlayerCount; s++)
                    {
                        var p = snap.PerPlayer[s];
                        double ratio = p.TakenTotal > 0 ? p.DealtTotal / (double)p.TakenTotal : p.DealtTotal;
                        rows.Add(new MeterRow
                        {
                            Name = s < snap.Labels.Length ? snap.Labels[s] : $"P{s + 1}",
                            Icon = s < snap.PlayerIcons.Length ? snap.PlayerIcons[s] : null, NameColor = UiTheme.Gold,
                            Value = ratio,
                            Right = $"{Ratio(p.DealtTotal, p.TakenTotal)}  ({Net(p.DealtTotal - p.TakenTotal)})",
                            Color = inp.Palette[Math.Min(s, inp.Palette.Length - 1)],
                            Tip = DiffTip(s < snap.Labels.Length ? snap.Labels[s] : "", p),
                        });
                    }
                    break;
                }
                var dt = DiffTip("Differential", ps);
                rows.Add(new MeterRow { Name = "Damage dealt", Value = ps.DealtTotal, Color = me, Tip = dt, Right = Fmt(ps.DealtTotal) });
                rows.Add(new MeterRow { Name = "Damage taken", Value = ps.TakenTotal, Color = UiTheme.Red, Tip = dt, Right = Fmt(ps.TakenTotal) });
                rows.Add(new MeterRow { Name = "Net", Value = Math.Abs(net), Color = net >= 0 ? HealGreen : UiTheme.Red, Tip = dt, Right = Net(net) });
                rows.Add(new MeterRow { Name = "Ratio", Value = 0, Color = UiTheme.Gold, Tip = dt, Right = Ratio(ps.DealtTotal, ps.TakenTotal) });
                return rows;
            }

            case MeterMode.DoomPoison:
            {
                var d = ps.Dots;
                var hud = inp.InCombat ? inp.Hud : null;
                strip = $"Doom + Poison {Fmt(d.Total)}  ·  {DotReader.Pct(d.Total, ps.DealtTotal)}% of your damage this {scope}";
                rows.Add(new MeterRow
                {
                    Name = DotReader.PoisonName, Icon = DotReader.PoisonIcon, Color = DotReader.PoisonColor, Pinned = true,
                    Value = d.PoisonTotal,
                    Right = $"{Fmt(d.PoisonTotal)} ({Rate(d.PoisonTotal / (double)turns)}, {DotReader.Pct(d.PoisonTotal, ps.DealtTotal)}%)",
                    Tip = PoisonTip(d, ps.DealtTotal, turns, hud),
                });
                if (hud != null)
                    foreach (var en in hud.Enemies)
                        if (en.Poison > 0)
                            rows.Add(new MeterRow
                            {
                                Sub = true, Name = en.Name, Color = DotReader.PoisonColor, Value = en.PoisonNextTurn,
                                Right = $"{en.Poison} stacks → {en.PoisonNextTurn} next",
                                Tip = EnemyTip(en),
                            });
                rows.Add(new MeterRow
                {
                    Name = DotReader.DoomName, Icon = DotReader.DoomIcon, Color = DotReader.DoomColor, Pinned = true,
                    Value = d.DoomTotal,
                    Right = $"{Fmt(d.DoomTotal)} ({d.DoomKills} kill{(d.DoomKills == 1 ? "" : "s")}, {DotReader.Pct(d.DoomTotal, ps.DealtTotal)}%)",
                    Tip = DoomTip(d, ps.DealtTotal, hud),
                });
                if (hud != null)
                    foreach (var en in hud.Enemies)
                        if (en.Doom > 0)
                            rows.Add(new MeterRow
                            {
                                Sub = true, Name = en.Name, Color = DotReader.DoomColor, Value = en.Doom,
                                Right = en.Doomed ? $"{en.Doom} vs {en.Hp} HP  DOOMED" : $"{en.Doom} vs {en.Hp} HP",
                                Tip = EnemyTip(en),
                            });
                return rows; // fixed order (Poison block, then Doom block) — not sorted by value
            }

            default: // Debuffs
            {
                var hud = inp.InCombat ? inp.Hud : null;
                if (hud == null)
                {
                    strip = "Live enemy debuffs appear here during combat";
                    return rows;
                }
                strip = $"{hud.DebuffCount} debuff{(hud.DebuffCount == 1 ? "" : "s")} on {hud.Enemies.Count} enem{(hud.Enemies.Count == 1 ? "y" : "ies")}";
                foreach (var en in hud.Enemies)
                {
                    string list = string.Join("  ", en.Debuffs.ConvertAll(x => $"{Short(x.Name)} {x.Amount}"));
                    rows.Add(new MeterRow
                    {
                        Name = en.Name,
                        Value = en.Debuffs.Count,
                        Right = en.Debuffs.Count == 0 ? "none" : $"{en.Debuffs.Count}: {list}",
                        Color = en.Doomed ? DotReader.DoomColor : new Color(0.93f, 0.62f, 0.25f),
                        Tip = EnemyTip(en),
                    });
                }
                break;
            }
        }
        rows.Sort((a, b) => b.Value.CompareTo(a.Value));
        return rows;
    }

    private static string Short(string s) => s.Length <= 5 ? s : s[..4] + ".";

    private static MeterTip PlayerTip(string name, PlayerSources p, int turns)
    {
        var t = new MeterTip { Title = name };
        int n = 0;
        foreach (var e in p.Dealt)
        {
            if (n++ >= 10) { t.Add($"+ {p.Dealt.Count - 10} more", "", new Color(1, 1, 1, 0.5f)); break; }
            var k = DotReader.KindOf(e.Name);
            t.Add(e.Name, $"{Fmt(e.Total)} ({DotReader.Pct(e.Total, p.DealtTotal)}%)", DotReader.ColorOf(k, UiTheme.Cream), e.Icon ?? DotReader.IconOf(k));
        }
        t.Add("Per turn", Rate(p.DealtTotal / (double)turns), UiTheme.Gold);
        if (p.Dots.HasData) t.Add("Doom + Poison", $"{Fmt(p.Dots.Total)} ({DotReader.Pct(p.Dots.Total, p.DealtTotal)}%)", DotReader.PoisonColor);
        return t;
    }

    internal static MeterTip SourceTip(SourceEntry e, long total, int turns, DotKind kind, DotTotals? dots, DotHud? hud, bool taken = false)
    {
        if (kind == DotKind.Poison && dots != null) return PoisonTip(dots, total, turns, hud);
        if (kind == DotKind.Doom && dots != null) return DoomTip(dots, total, hud);
        var t = new MeterTip { Title = e.Name, TitleColor = taken ? UiTheme.Red : UiTheme.Gold };
        t.Add(taken ? "Damage taken" : "Damage", Fmt(e.Total), UiTheme.Cream, e.Icon);
        if (e.Hits > 0)
        {
            t.Add("Hits", e.Hits.ToString());
            t.Add("Average hit", Rate(e.Total / (double)e.Hits));
            t.Add("Biggest hit", e.MaxHit.ToString());
        }
        t.Add("Per turn", Rate(e.Total / (double)turns));
        t.Add(taken ? "% of damage taken" : "% of your damage", $"{DotReader.Pct(e.Total, total)}%");
        return t;
    }

    private static MeterTip DefenseTip(string name, PlayerSources p, int turns)
    {
        long inc = p.BlockedTotal + p.TakenTotal;
        var t = new MeterTip { Title = name, TitleColor = BlockBlue };
        t.Add("Damage blocked", Fmt(p.BlockedTotal), BlockBlue);
        t.Add("Hits blocked", p.BlockedHits.ToString());
        t.Add("Incoming damage", Fmt(inc));
        t.Add("% stopped by block", $"{DotReader.Pct(p.BlockedTotal, inc)}%");
        t.Add("Block gained", Fmt(p.BlockTotal));
        t.Add("% of block used", $"{DotReader.Pct(p.BlockedTotal, p.BlockTotal)}%");
        t.Add("HP lost", Fmt(p.TakenTotal), UiTheme.Red);
        t.Add("Healed", Fmt(p.HealTotal), HealGreen);
        t.Add("Blocked per turn", Rate(p.BlockedTotal / (double)turns));
        return t;
    }

    private static MeterTip DiffTip(string name, PlayerSources p)
    {
        var t = new MeterTip { Title = name };
        t.Add("Dealt", Fmt(p.DealtTotal));
        t.Add("Taken (HP lost)", Fmt(p.TakenTotal), UiTheme.Red);
        t.Add("Ratio  (dealt ÷ taken)", Ratio(p.DealtTotal, p.TakenTotal), UiTheme.Gold);
        t.Add("Net  (dealt − taken)", Net(p.DealtTotal - p.TakenTotal), UiTheme.Gold);
        t.Add("Pressure  (dealt ÷ incoming)", Ratio(p.DealtTotal, p.TakenTotal + p.BlockedTotal));
        t.Add("  incoming = taken + blocked", "", new Color(1, 1, 1, 0.55f));
        return t;
    }

    private static MeterTip PoisonTip(DotTotals d, long dealt, int turns, DotHud? hud)
    {
        var t = new MeterTip { Title = DotReader.PoisonName, TitleColor = DotReader.PoisonColor };
        t.Add("Poison damage", Fmt(d.PoisonTotal), DotReader.PoisonColor, DotReader.PoisonIcon);
        t.Add("% of your damage", $"{DotReader.Pct(d.PoisonTotal, dealt)}%");
        t.Add("Ticks", d.PoisonTicks.ToString());
        t.Add("Average tick", d.PoisonTicks > 0 ? Rate(d.PoisonTotal / (double)d.PoisonTicks) : "0");
        t.Add("Biggest tick", d.PoisonMaxTick.ToString());
        t.Add("Per turn", Rate(d.PoisonTotal / (double)turns));
        t.Add("Kills", d.PoisonKills.ToString());
        if (hud != null)
        {
            t.Add("On enemies now", $"{hud.PoisonOnEnemies} stacks", DotReader.PoisonColor);
            t.Add("Next tick total", hud.PoisonNextTurn.ToString(), DotReader.PoisonColor);
        }
        return t;
    }

    private static MeterTip DoomTip(DotTotals d, long dealt, DotHud? hud)
    {
        var t = new MeterTip { Title = DotReader.DoomName, TitleColor = DotReader.DoomColor };
        t.Add("HP executed by Doom", Fmt(d.DoomTotal), DotReader.DoomColor, DotReader.DoomIcon);
        t.Add("% of your damage", $"{DotReader.Pct(d.DoomTotal, dealt)}%");
        t.Add("Kills", d.DoomKills.ToString());
        if (hud != null)
        {
            t.Add("On enemies now", $"{hud.DoomOnEnemies} stacks", DotReader.DoomColor);
            t.Add("Doomed now", $"{hud.DoomedCount} (die at end of turn)", DotReader.DoomColor);
        }
        return t;
    }

    private static MeterTip EnemyTip(EnemyStatus en)
    {
        var t = new MeterTip { Title = $"{en.Name}  {en.Hp}/{en.MaxHp} HP" };
        if (en.Debuffs.Count == 0) t.Add("No debuffs", "", new Color(1, 1, 1, 0.6f));
        foreach (var d in en.Debuffs)
        {
            var k = DotReader.KindOf(d.Name);
            t.Add(d.Name, d.Amount.ToString(), DotReader.ColorOf(k, UiTheme.Cream), d.Icon);
        }
        if (en.Poison > 0) t.Add("Poison next tick", en.PoisonNextTurn.ToString(), DotReader.PoisonColor);
        if (en.Doom > 0) t.Add(en.Doomed ? "DOOMED — dies at end of turn" : $"Doom needs HP ≤ {en.Doom}", "", DotReader.DoomColor);
        return t;
    }
}

// Details!-style meter window: dark frame, title bar with ◀ mode ▶ and a Fight/Run segment button, a
// one-line summary strip, then ranked horizontal bars ("1. [icon] Name ........ total (per turn, %)").
// Hovering a row shows a Details-like tooltip; clicking a row opens the full breakdown; the wheel
// scrolls rows. Dragging the title bar moves it (position saved). Poll-based mouse, like the other views.
internal sealed class MeterView
{
    private const float BaseW = 330f, BaseTitleH = 24f, BaseStripH = 18f, BaseRowH = 21f;

    private readonly CanvasLayer _layer;
    private readonly Control _container;
    private readonly Control _hit;          // Stop filter under the window: blocks click-through, receives the wheel
    private readonly ColorRect _bg, _titleBg, _titleLine;
    private readonly Control _barLayer;
    private readonly List<ColorRect> _rects = new();
    private readonly List<Label> _labels = new();
    private readonly List<TextureRect> _icons = new();
    private readonly Dictionary<string, Texture2D?> _texCache = new();
    private readonly MeterTooltip _tip;

    public MeterMode Mode = MeterMode.DamageDone;
    public bool RunSegmentChosen;          // user picked "Run" while in combat
    public int MaxRows = 8;               // rows shown at once (config meter_rows)
    public float RowScale = 1f;           // bar height multiplier: dragging the corner taller makes the bars taller
    public const float MinRowScale = 0.75f, MaxRowScale = 3f;
    public float WidthBase = BaseW;       // window width at 1080p before scaling (set by the corner grip)
    public const float MinWidthBase = 220f, MaxWidthBase = 900f;
    public float UiScaleMul = 1f;
    public bool ModeChanged;               // set when the user changed mode/segment (mod persists it)
    public int DebugHoverRow = -1;         // test hook: force the tooltip for this visible row

    private Vector2 _posFrac; private bool _posFracInit;
    private Vector2 _vp = new(1920, 1080);
    private float _w = BaseW, _h = 100f, _titleH = BaseTitleH;
    private float _sc = 1f;
    private bool _resizing;
    private Rect2 _gripRect;
    private bool _dragging, _leftLast, _pressOnWindow, _clicked;
    private Vector2 _dragOffset, _pressStart;
    private int _scroll;
    private Rect2 _prevRect, _nextRect, _segRect;
    private readonly List<(Rect2 Rect, MeterRow Row)> _rowRects = new();
    private bool _segEnabled;

    public MeterView(Node root, Vector2? savedPosFrac)
    {
        _layer = new CanvasLayer { Layer = 128, Name = "Sts2DamageMeter" };
        root.AddChild(_layer);
        _hit = new Control { MouseFilter = Control.MouseFilterEnum.Stop };
        _hit.GuiInput += OnGuiInput;
        _layer.AddChild(_hit);
        _container = new Control { MouseFilter = Control.MouseFilterEnum.Ignore };
        _layer.AddChild(_container);
        _bg = new ColorRect { Color = new Color(0.035f, 0.035f, 0.045f, 0.80f), MouseFilter = Control.MouseFilterEnum.Ignore };
        _container.AddChild(_bg);
        _titleBg = new ColorRect { Color = new Color(0.10f, 0.10f, 0.12f, 0.96f), MouseFilter = Control.MouseFilterEnum.Ignore };
        _container.AddChild(_titleBg);
        _titleLine = new ColorRect { Color = new Color(UiTheme.Gold.R, UiTheme.Gold.G, UiTheme.Gold.B, 0.55f), MouseFilter = Control.MouseFilterEnum.Ignore };
        _container.AddChild(_titleLine);
        _barLayer = new Control { MouseFilter = Control.MouseFilterEnum.Ignore };
        _container.AddChild(_barLayer);
        _tip = new MeterTooltip(root);
        if (savedPosFrac.HasValue) { _posFrac = savedPosFrac.Value; _posFracInit = true; }
    }

    public bool IsValid() => GodotObject.IsInstanceValid(_layer);
    public bool IsShown => IsValid() && _layer.Visible;
    public void Hide() { if (IsValid()) _layer.Visible = false; _tip.Hide(); }
    public void Dispose() { if (IsValid()) _layer.QueueFree(); _tip.Dispose(); }
    public Vector2 PositionFraction => _posFrac;
    public bool TakeRowClick() { var c = _clicked; _clicked = false; return c; }

    private void OnGuiInput(InputEvent e)
    {
        try
        {
            if (e is InputEventMouseButton mb && mb.Pressed)
            {
                if (mb.ButtonIndex == MouseButton.WheelUp) { _scroll = Math.Max(0, _scroll - 1); _hit.AcceptEvent(); }
                else if (mb.ButtonIndex == MouseButton.WheelDown) { _scroll++; _hit.AcceptEvent(); }
            }
        }
        catch { }
    }

    // Returns true when a drag finished (caller saves the position).
    public bool UpdateMouse(bool leftDown)
    {
        if (!IsValid() || !_layer.Visible) { _leftLast = leftDown; return false; }
        bool saved = false;
        try
        {
            Vector2 local = _container.GetLocalMousePosition();
            Vector2 global = _container.GetGlobalMousePosition();
            bool over = local.X >= 0 && local.X <= _w && local.Y >= 0 && local.Y <= _h;
            bool onTitle = over && local.Y <= _titleH;

            if (leftDown && !_leftLast)
            {
                _pressStart = global;
                // Details-style: grab anywhere on the window to drag it; a click without moving still
                // switches mode / opens the breakdown. Offset from where the window is actually drawn.
                _pressOnWindow = over;
                if (over) _dragOffset = global - _container.GlobalPosition;
                if (over && _gripRect.HasPoint(local)) { _resizing = true; _pressOnWindow = false; }
            }
            else if (leftDown && _resizing)
            {
                // Corner grip: width follows the cursor; height scales the bars (same row count, taller bars).
                float wantW = Math.Clamp(local.X, MinWidthBase * _sc, Math.Min(MaxWidthBase * _sc, _vp.X));
                WidthBase = wantW / _sc;
                float perRow = (local.Y - _titleH - BaseStripH * _sc) / Math.Max(3, MaxRows);
                RowScale = Math.Clamp(perRow / (BaseRowH * _sc), MinRowScale, MaxRowScale);
            }
            else if (leftDown && _pressOnWindow)
            {
                if (!_dragging && (global - _pressStart).Length() > 5f) _dragging = true;
                if (_dragging)
                {
                    Vector2 abs = global - _dragOffset;
                    float yMin = _vp.Y > 0 ? TopInset(_vp) / _vp.Y : 0f;
                    _posFrac = new Vector2(
                        Math.Clamp(abs.X / _vp.X, 0f, Math.Max(0f, 1f - _w / _vp.X)),
                        Math.Clamp(abs.Y / _vp.Y, yMin, Math.Max(yMin, 1f - _h / _vp.Y)));
                }
            }
            else if (!leftDown && _leftLast)
            {
                bool moved = (global - _pressStart).Length() > 5f;
                if (_resizing) { _resizing = false; saved = moved; }
                else if (_dragging) { _dragging = false; saved = moved; }
                else if (!moved && over)
                {
                    int nModes = Enum.GetValues(typeof(MeterMode)).Length;
                    if (_prevRect.HasPoint(local)) { Mode = (MeterMode)(((int)Mode + nModes - 1) % nModes); _scroll = 0; ModeChanged = true; }
                    else if (_segEnabled && _segRect.HasPoint(local)) { RunSegmentChosen = !RunSegmentChosen; _scroll = 0; ModeChanged = true; }
                    else if (onTitle || _nextRect.HasPoint(local)) { Mode = (MeterMode)(((int)Mode + 1) % nModes); _scroll = 0; ModeChanged = true; }
                    else _clicked = true; // a row → open the full breakdown
                }
                _pressOnWindow = false;
            }
            _leftLast = leftDown;

            // Hover tooltip (Details: hovering a bar shows its breakdown).
            MeterTip? tip = null;
            if (!_dragging && !_resizing && over && !onTitle && !_gripRect.HasPoint(local))
                foreach (var r in _rowRects) if (r.Rect.HasPoint(local)) { tip = r.Row.Tip; break; }
            if (DebugHoverRow >= 0 && DebugHoverRow < _rowRects.Count)
            {
                var rr = _rowRects[DebugHoverRow].Rect;
                tip = _rowRects[DebugHoverRow].Row.Tip;
                global = _container.GlobalPosition + rr.Position + new Vector2(rr.Size.X * 0.3f, rr.Size.Y * 0.5f);
            }
            if (tip != null) _tip.Render(tip, global, UiScaleMul); else _tip.Hide();
        }
        catch { }
        return saved;
    }

    private static float TopInset(Vector2 vp) => Math.Max(48f, vp.Y * 0.09f);

    public void Render(MeterInput inp)
    {
        if (!IsValid()) return;
        try
        {
            _layer.Visible = true;
            _vp = _container.GetViewportRect().Size;
            float sc = UiTheme.Scale(_vp) * Math.Clamp(UiScaleMul, 0.5f, 4f);
            _sc = sc;
            _w = Math.Clamp(WidthBase, MinWidthBase, MaxWidthBase) * sc; _titleH = BaseTitleH * sc;
            float rs = Math.Clamp(RowScale, MinRowScale, MaxRowScale);
            float stripH = BaseStripH * sc, rowH = BaseRowH * sc * rs;

            var rows = MeterRows.Build(Mode, inp, out string strip);
            int maxRows = Math.Max(3, MaxRows);
            // Keep pinned rows (Poison / Doom) visible even when they'd rank below the fold.
            if (Mode == MeterMode.DamageDone && rows.Count > maxRows)
            {
                var head = rows.GetRange(0, maxRows);
                var missing = rows.FindAll(r => r.Pinned && !head.Contains(r));
                for (int i = 0; i < missing.Count && i < head.Count; i++) head[head.Count - 1 - i] = missing[i];
                if (missing.Count > 0) { head.Sort((a, b) => b.Value.CompareTo(a.Value)); rows = head; }
            }
            int shown = Math.Min(maxRows, Math.Max(1, rows.Count));
            _scroll = Math.Clamp(_scroll, 0, Math.Max(0, rows.Count - shown));
            // Fixed height like Details!: the window is as tall as the rows chosen with the corner grip.
            _h = _titleH + stripH + maxRows * rowH + 3f * sc;

            if (!_posFracInit)
            {
                _posFrac = new Vector2((_vp.X - _w - 14f * sc) / _vp.X, TopInset(_vp) / _vp.Y + 0.01f);
                _posFracInit = true;
            }
            float px = Math.Clamp(_posFrac.X * _vp.X, 0f, Math.Max(0f, _vp.X - _w));
            float py = Math.Clamp(_posFrac.Y * _vp.Y, TopInset(_vp), Math.Max(TopInset(_vp), _vp.Y - _h));
            _container.SetPosition(new Vector2(px, py));
            _container.SetSize(new Vector2(_w, _h));
            _hit.SetPosition(new Vector2(px, py)); _hit.SetSize(new Vector2(_w, _h));
            _bg.SetPosition(Vector2.Zero); _bg.SetSize(new Vector2(_w, _h));
            _titleBg.SetPosition(Vector2.Zero); _titleBg.SetSize(new Vector2(_w, _titleH));
            _titleLine.SetPosition(new Vector2(0, _titleH - Math.Max(1f, sc))); _titleLine.SetSize(new Vector2(_w, Math.Max(1f, sc)));
            _barLayer.SetSize(new Vector2(_w, _h));

            int lc = 0, rc = 0, ic = 0;
            _rowRects.Clear();
            int fTitle = F(14, sc), fRow = F(13, sc * Math.Clamp(rs, 0.85f, 2.2f)), fStrip = F(11, sc);

            // Title bar: ◀ Mode ▶ on the left, Fight/Run segment button on the right.
            float ax = 6f * sc;
            var prev = NextLabel(ref lc, fTitle, UiTheme.Gold); prev.Text = "◀"; prev.SetPosition(new Vector2(ax, 2f * sc));
            _prevRect = new Rect2(0, 0, 22f * sc, _titleH);
            var title = NextLabel(ref lc, fTitle, UiTheme.Cream); title.Text = MeterRows.ModeName(Mode);
            title.SetPosition(new Vector2(ax + 18f * sc, 2f * sc));
            float titleW = MeterRows.ModeName(Mode).Length * fTitle * 0.55f;
            var next = NextLabel(ref lc, fTitle, UiTheme.Gold); next.Text = "▶"; next.SetPosition(new Vector2(ax + 24f * sc + titleW, 2f * sc));
            _nextRect = new Rect2(ax + 20f * sc + titleW, 0, 24f * sc, _titleH);

            _segEnabled = inp.CanToggleSegment;
            string seg = inp.RunSegment ? "Run" : "Fight";
            float segW = 52f * sc, segX = _w - segW - 5f * sc;
            _segRect = new Rect2(segX, 3f * sc, segW, _titleH - 6f * sc);
            var segBg = NextRect(ref rc);
            segBg.Color = inp.RunSegment ? new Color(0.45f, 0.35f, 0.08f, 0.95f) : new Color(0.20f, 0.22f, 0.28f, 0.95f);
            segBg.SetPosition(_segRect.Position); segBg.SetSize(_segRect.Size);
            var segL = NextLabel(ref lc, fStrip, _segEnabled ? UiTheme.Gold : new Color(UiTheme.Gold.R, UiTheme.Gold.G, UiTheme.Gold.B, 0.7f));
            segL.Text = seg; segL.HorizontalAlignment = HorizontalAlignment.Center;
            segL.SetPosition(new Vector2(segX, 4f * sc)); segL.SetSize(new Vector2(segW, _titleH - 8f * sc));

            // Summary strip.
            var st = NextLabel(ref lc, fStrip, new Color(UiTheme.Cream.R, UiTheme.Cream.G, UiTheme.Cream.B, 0.75f));
            st.Text = strip; st.SetPosition(new Vector2(6f * sc, _titleH + 1f * sc));

            float y0 = _titleH + stripH;
            if (rows.Count == 0)
            {
                var none = NextLabel(ref lc, fRow, new Color(1, 1, 1, 0.5f));
                none.Text = Mode == MeterMode.Debuffs ? "Not in combat" : "No data yet";
                none.SetPosition(new Vector2(8f * sc, y0 + 2f * sc));
            }
            double top = 0;
            foreach (var r in rows) if (!r.Sub && r.Value > top) top = r.Value;
            if (top <= 0) foreach (var r in rows) if (r.Value > top) top = r.Value;
            if (top <= 0) top = 1;

            int rank = 0;
            for (int i = 0; i < rows.Count; i++) if (!rows[i].Sub && i < _scroll) rank++;
            for (int i = _scroll; i < rows.Count && i < _scroll + shown; i++)
            {
                var r = rows[i];
                float y = y0 + (i - _scroll) * rowH;
                float inset = r.Sub ? 16f * sc : 0f;
                float bx = 2f * sc + inset, bwMax = _w - 4f * sc - inset, bh = rowH - 2f * sc;
                _rowRects.Add((new Rect2(0, y, _w, rowH), r));

                var back = NextRect(ref rc);
                back.Color = new Color(1f, 1f, 1f, 0.035f);
                back.SetPosition(new Vector2(bx, y + 1f * sc)); back.SetSize(new Vector2(bwMax, bh));

                float fw = (float)(bwMax * Math.Clamp(r.Value / top, 0.0, 1.0));
                if (fw > 0.5f)
                {
                    float a = r.Sub ? 0.45f : 0.82f;
                    double segSum = 0;
                    if (r.Segs != null) foreach (var sg in r.Segs) segSum += Math.Max(0, sg.Value);
                    if (r.Segs != null && segSum > 0)
                    {
                        // Stacked bar: direct damage in the character color, then Poison (lime), then Doom (violet).
                        float sx = bx;
                        foreach (var sg in r.Segs)
                        {
                            float sw = (float)(fw * Math.Max(0, sg.Value) / segSum);
                            if (sw < 0.5f) continue;
                            var part = NextRect(ref rc);
                            part.Color = new Color(sg.Color.R * 0.78f, sg.Color.G * 0.78f, sg.Color.B * 0.78f, a);
                            part.SetPosition(new Vector2(sx, y + 1f * sc)); part.SetSize(new Vector2(sw, bh));
                            sx += sw;
                        }
                    }
                    else
                    {
                        var bar = NextRect(ref rc);
                        bar.Color = new Color(r.Color.R * 0.78f, r.Color.G * 0.78f, r.Color.B * 0.78f, a);
                        bar.SetPosition(new Vector2(bx, y + 1f * sc)); bar.SetSize(new Vector2(fw, bh));
                    }
                    var gloss = NextRect(ref rc); // Details-style bar texture: lighter top half
                    gloss.Color = new Color(1f, 1f, 1f, 0.10f);
                    gloss.SetPosition(new Vector2(bx, y + 1f * sc)); gloss.SetSize(new Vector2(fw, bh * 0.45f));
                }

                float tx = bx + 4f * sc;
                if (!r.Sub)
                {
                    rank++;
                    var rk = NextLabel(ref lc, fRow, UiTheme.Cream); rk.Text = $"{rank}."; rk.SetPosition(new Vector2(tx, y + 1f * sc));
                    tx += (rank >= 10 ? 24f : 17f) * sc;
                }
                if (r.Icon != null && LoadTex(r.Icon) is { } tex)
                {
                    var icn = NextIcon(ref ic); icn.Texture = tex;
                    icn.SetPosition(new Vector2(tx, y + 1.5f * sc)); icn.SetSize(new Vector2(bh - 1f * sc, bh - 1f * sc));
                    tx += bh + 2f * sc;
                }
                var right = NextLabel(ref lc, fRow, UiTheme.Cream);
                right.Text = r.Right; right.HorizontalAlignment = HorizontalAlignment.Right;
                float rightW = r.Right.Length * fRow * 0.52f;
                right.SetPosition(new Vector2(bx, y + 1f * sc)); right.SetSize(new Vector2(bwMax - 4f * sc, bh));
                var name = NextLabel(ref lc, fRow, r.NameColor ?? (r.Sub ? new Color(UiTheme.Cream.R, UiTheme.Cream.G, UiTheme.Cream.B, 0.8f) : UiTheme.Cream));
                int maxChars = Math.Max(4, (int)((bwMax - (tx - bx) - rightW - 8f * sc) / (fRow * 0.52f)));
                name.Text = r.Name.Length <= maxChars ? r.Name : r.Name[..Math.Max(1, maxChars - 1)] + "…";
                name.HorizontalAlignment = HorizontalAlignment.Left;
                name.SetPosition(new Vector2(tx, y + 1f * sc)); name.SetSize(Vector2.Zero);
            }
            if (rows.Count > shown) // scroll hint, like Details' scrollbar
            {
                float trackH = shown * rowH, gh = Math.Max(6f * sc, trackH * shown / rows.Count);
                var sb = NextRect(ref rc);
                sb.Color = new Color(UiTheme.Gold.R, UiTheme.Gold.G, UiTheme.Gold.B, 0.55f);
                sb.SetPosition(new Vector2(_w - 3f * sc, y0 + (trackH - gh) * _scroll / Math.Max(1, rows.Count - shown)));
                sb.SetSize(new Vector2(2f * sc, gh));
            }

            // Resize grip: a small stepped triangle in the bottom-right corner (brighter while dragging/hovered).
            float g = 14f * sc;
            _gripRect = new Rect2(_w - g, _h - g, g, g);
            bool gripHot = _resizing || _gripRect.HasPoint(_container.GetLocalMousePosition());
            var gc = new Color(UiTheme.Gold.R, UiTheme.Gold.G, UiTheme.Gold.B, gripHot ? 0.95f : 0.45f);
            float dot = Math.Max(2f, 2.5f * sc);
            for (int row = 0; row < 3; row++)
                for (int col = 0; col <= row; col++)
                {
                    var d = NextRect(ref rc);
                    d.Color = gc;
                    d.SetPosition(new Vector2(_w - (col + 1) * (dot + 1.5f * sc) - 1f * sc, _h - (3 - row) * (dot + 1.5f * sc) - 1f * sc));
                    d.SetSize(new Vector2(dot, dot));
                }

            for (int i = lc; i < _labels.Count; i++) _labels[i].Visible = false;
            for (int i = rc; i < _rects.Count; i++) _rects[i].Visible = false;
            for (int i = ic; i < _icons.Count; i++) _icons[i].Visible = false;
        }
        catch (Exception ex) { GD.PrintErr($"[STS2 Damage] meter render error: {ex.Message}"); }
    }

    private static int F(int b, float sc) => Math.Max(8, (int)Math.Round(b * sc));

    private Label NextLabel(ref int cur, int size, Color color)
    {
        Label l;
        if (cur < _labels.Count) l = _labels[cur];
        else { l = UiTheme.MakeLabel(size, color); _container.AddChild(l); _labels.Add(l); }
        UiTheme.Apply(l, size, color);
        l.HorizontalAlignment = HorizontalAlignment.Left;
        l.SetSize(Vector2.Zero);
        l.Visible = true; cur++;
        return l;
    }

    private ColorRect NextRect(ref int cur)
    {
        ColorRect r;
        if (cur < _rects.Count) r = _rects[cur];
        else { r = new ColorRect { MouseFilter = Control.MouseFilterEnum.Ignore }; _barLayer.AddChild(r); _rects.Add(r); }
        r.Visible = true; cur++;
        return r;
    }

    private TextureRect NextIcon(ref int cur)
    {
        TextureRect t;
        if (cur < _icons.Count) t = _icons[cur];
        else
        {
            t = new TextureRect { MouseFilter = Control.MouseFilterEnum.Ignore, ExpandMode = TextureRect.ExpandModeEnum.IgnoreSize, StretchMode = TextureRect.StretchModeEnum.KeepAspectCentered };
            _barLayer.AddChild(t); _icons.Add(t);
        }
        t.Visible = true; cur++;
        return t;
    }

    private Texture2D? LoadTex(string path)
    {
        if (_texCache.TryGetValue(path, out var c)) return c;
        Texture2D? tex = null;
        try { if (ResourceLoader.Exists(path)) tex = ResourceLoader.Load<Texture2D>(path, null, ResourceLoader.CacheMode.Reuse); } catch { }
        _texCache[path] = tex;
        return tex;
    }
}

// Details!-style tooltip: dark box, colored title, then "icon  name ........ value" lines.
internal sealed class MeterTooltip
{
    private readonly CanvasLayer _layer;
    private readonly Control _c;
    private readonly ColorRect _bg, _border;
    private readonly List<Label> _labels = new();
    private readonly List<TextureRect> _icons = new();
    private readonly Dictionary<string, Texture2D?> _texCache = new();

    public MeterTooltip(Node root)
    {
        _layer = new CanvasLayer { Layer = 131, Name = "Sts2DamageMeterTip", Visible = false };
        root.AddChild(_layer);
        _c = new Control { MouseFilter = Control.MouseFilterEnum.Ignore };
        _layer.AddChild(_c);
        _border = new ColorRect { MouseFilter = Control.MouseFilterEnum.Ignore };
        _c.AddChild(_border);
        _bg = new ColorRect { Color = new Color(0.03f, 0.03f, 0.04f, 0.95f), MouseFilter = Control.MouseFilterEnum.Ignore };
        _c.AddChild(_bg);
    }

    public void Hide() { if (GodotObject.IsInstanceValid(_layer)) _layer.Visible = false; }
    public void Dispose() { if (GodotObject.IsInstanceValid(_layer)) _layer.QueueFree(); }

    public void Render(MeterTip tip, Vector2 mouse, float uiMul)
    {
        if (!GodotObject.IsInstanceValid(_layer)) return;
        try
        {
            _layer.Visible = true;
            Vector2 vp = _c.GetViewportRect().Size;
            float sc = UiTheme.Scale(vp) * Math.Clamp(uiMul, 0.5f, 4f);
            float W = 290f * sc, pad = 8f * sc, lineH = 19f * sc;
            int f = Math.Max(8, (int)Math.Round(13 * sc));
            int lc = 0, ic = 0;
            float y = pad;
            var t = Next(ref lc, Math.Max(9, (int)Math.Round(15 * sc)), tip.TitleColor);
            t.Text = tip.Title; t.SetPosition(new Vector2(pad, y));
            y += 24f * sc;
            foreach (var ln in tip.Lines)
            {
                float tx = pad;
                if (ln.Icon != null && LoadTex(ln.Icon) is { } tex)
                {
                    var i = NextIcon(ref ic); i.Texture = tex;
                    i.SetPosition(new Vector2(pad, y)); i.SetSize(new Vector2(lineH - 2f, lineH - 2f));
                    tx += lineH + 2f * sc;
                }
                var l = Next(ref lc, f, ln.Color); l.Text = ln.Left; l.SetPosition(new Vector2(tx, y));
                if (ln.Right.Length > 0)
                {
                    var r = Next(ref lc, f, UiTheme.Cream); r.Text = ln.Right;
                    r.HorizontalAlignment = HorizontalAlignment.Right;
                    r.SetPosition(new Vector2(pad, y)); r.SetSize(new Vector2(W - pad * 2f, lineH));
                }
                y += lineH;
            }
            float H = y + pad;
            _border.Color = new Color(tip.TitleColor.R, tip.TitleColor.G, tip.TitleColor.B, 0.7f);
            _border.SetPosition(Vector2.Zero); _border.SetSize(new Vector2(W, H));
            _bg.SetPosition(new Vector2(1, 1)); _bg.SetSize(new Vector2(W - 2, H - 2));
            // Details anchors the tooltip beside the window; here: beside the cursor, flipped at edges.
            float off = 24f * sc;
            float x = mouse.X - W - off; if (x < 0) x = mouse.X + off;
            float py = mouse.Y - H * 0.25f;
            _c.SetPosition(new Vector2(Math.Clamp(x, 0, Math.Max(0, vp.X - W)), Math.Clamp(py, 0, Math.Max(0, vp.Y - H))));
            for (int i = lc; i < _labels.Count; i++) _labels[i].Visible = false;
            for (int i = ic; i < _icons.Count; i++) _icons[i].Visible = false;
        }
        catch (Exception ex) { GD.PrintErr($"[STS2 Damage] meter tooltip error: {ex.Message}"); }
    }

    private Label Next(ref int cur, int size, Color color)
    {
        Label l;
        if (cur < _labels.Count) l = _labels[cur];
        else { l = UiTheme.MakeLabel(size, color); _c.AddChild(l); _labels.Add(l); }
        UiTheme.Apply(l, size, color);
        l.HorizontalAlignment = HorizontalAlignment.Left; l.SetSize(Vector2.Zero);
        l.Visible = true; cur++;
        return l;
    }

    private TextureRect NextIcon(ref int cur)
    {
        TextureRect t;
        if (cur < _icons.Count) t = _icons[cur];
        else
        {
            t = new TextureRect { MouseFilter = Control.MouseFilterEnum.Ignore, ExpandMode = TextureRect.ExpandModeEnum.IgnoreSize, StretchMode = TextureRect.StretchModeEnum.KeepAspectCentered };
            _c.AddChild(t); _icons.Add(t);
        }
        t.Visible = true; cur++;
        return t;
    }

    private Texture2D? LoadTex(string path)
    {
        if (_texCache.TryGetValue(path, out var c)) return c;
        Texture2D? tex = null;
        try { if (ResourceLoader.Exists(path)) tex = ResourceLoader.Load<Texture2D>(path, null, ResourceLoader.CacheMode.Reuse); } catch { }
        _texCache[path] = tex;
        return tex;
    }
}
