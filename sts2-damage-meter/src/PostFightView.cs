using System;
using System.Collections.Generic;
using Godot;

namespace STS2_DamageCharts;

// End-of-fight summary, Details-style (replaces the old click-through summary panel):
//   title bar  "Fight Summary · N turns"                       ✕
//   player tabs (co-op): [icon Name] [icon Name] — click to view that player
//   totals     DEALT  PER TURN  TAKEN  HEALED  BLOCK
//   Doom & Poison line
//   DAMAGE DEALT  ranked bars (icon, name, total, %)
//   DAMAGE TAKEN  ranked bars
// Drag it from anywhere; hover a row for hits / average / biggest hit. Poll-based mouse like the meter.
internal sealed class PostFightView
{
    private const float BaseW = 400f;
    private const int DealtRows = 7, TakenRows = 4;

    private readonly CanvasLayer _layer;
    private readonly Control _hit;
    private readonly Control _c;
    private readonly ColorRect _bg, _titleBg, _titleLine;
    private readonly Control _barLayer;
    private readonly List<ColorRect> _rects = new();
    private readonly List<Label> _labels = new();
    private readonly List<TextureRect> _icons = new();
    private readonly Dictionary<string, Texture2D?> _texCache = new();
    private readonly MeterTooltip _tip;

    public float UiScaleMul = 1f;
    public int ViewSlot = -1;          // player being viewed (-1 = you); reset each fight by the mod
    public string SubPrefix = "";      // extra facts at the start of the sub line (run panel: "12 fights")

    private Vector2 _posFrac; private bool _posFracInit;
    private Vector2 _vp = new(1920, 1080);
    private float _w = BaseW, _h = 300f;
    private bool _dragging, _leftLast, _pressOver, _closeReq;
    private Vector2 _dragOffset, _pressStart;
    private Rect2 _closeRect;
    private readonly List<(Rect2 Rect, int Slot)> _tabRects = new();
    private readonly List<(Rect2 Rect, MeterTip Tip)> _rowTips = new();

    public PostFightView(Node root, Vector2? savedPosFrac)
    {
        _layer = new CanvasLayer { Layer = 129, Name = "Sts2DamagePostFight", Visible = false };
        root.AddChild(_layer);
        _hit = new Control { MouseFilter = Control.MouseFilterEnum.Stop };
        _layer.AddChild(_hit);
        _c = new Control { MouseFilter = Control.MouseFilterEnum.Ignore };
        _layer.AddChild(_c);
        _bg = new ColorRect { Color = new Color(0.035f, 0.035f, 0.045f, 0.90f), MouseFilter = Control.MouseFilterEnum.Ignore };
        _c.AddChild(_bg);
        _titleBg = new ColorRect { Color = new Color(0.10f, 0.10f, 0.12f, 0.97f), MouseFilter = Control.MouseFilterEnum.Ignore };
        _c.AddChild(_titleBg);
        _titleLine = new ColorRect { Color = new Color(UiTheme.Gold.R, UiTheme.Gold.G, UiTheme.Gold.B, 0.55f), MouseFilter = Control.MouseFilterEnum.Ignore };
        _c.AddChild(_titleLine);
        _barLayer = new Control { MouseFilter = Control.MouseFilterEnum.Ignore };
        _c.AddChild(_barLayer);
        _tip = new MeterTooltip(root);
        if (savedPosFrac.HasValue) { _posFrac = savedPosFrac.Value; _posFracInit = true; }
    }

    public bool IsValid() => GodotObject.IsInstanceValid(_layer);
    public bool IsShown => IsValid() && _layer.Visible;
    public void Hide() { if (IsValid()) _layer.Visible = false; _tip.Hide(); }
    public void Dispose() { if (IsValid()) _layer.QueueFree(); _tip.Dispose(); }
    public Vector2 PositionFraction => _posFrac;
    public bool TakeCloseRequest() { var c = _closeReq; _closeReq = false; return c; }

    private static float TopInset(Vector2 vp) => Math.Max(48f, vp.Y * 0.09f);

    // Returns true when a drag finished (caller saves the position).
    public bool UpdateMouse(bool leftDown)
    {
        if (!IsShown) { _leftLast = leftDown; return false; }
        bool saved = false;
        try
        {
            Vector2 local = _c.GetLocalMousePosition();
            Vector2 global = _c.GetGlobalMousePosition();
            bool over = local.X >= 0 && local.X <= _w && local.Y >= 0 && local.Y <= _h;
            if (leftDown && !_leftLast)
            {
                _pressStart = global; _pressOver = over;
                if (over) _dragOffset = global - _c.GlobalPosition;
            }
            else if (leftDown && _pressOver)
            {
                if (!_dragging && (global - _pressStart).Length() > 5f) _dragging = true;
                if (_dragging)
                {
                    Vector2 abs = global - _dragOffset;
                    float yMin = TopInset(_vp) / _vp.Y;
                    _posFrac = new Vector2(
                        Math.Clamp(abs.X / _vp.X, 0f, Math.Max(0f, 1f - _w / _vp.X)),
                        Math.Clamp(abs.Y / _vp.Y, yMin, Math.Max(yMin, 1f - _h / _vp.Y)));
                }
            }
            else if (!leftDown && _leftLast)
            {
                bool moved = (global - _pressStart).Length() > 5f;
                if (_dragging) { _dragging = false; saved = moved; }
                else if (!moved && over)
                {
                    if (_closeRect.HasPoint(local)) _closeReq = true;
                    else foreach (var t in _tabRects) if (t.Rect.HasPoint(local)) { ViewSlot = t.Slot; break; }
                }
                _pressOver = false;
            }
            _leftLast = leftDown;

            MeterTip? tip = null;
            if (!_dragging && over) foreach (var r in _rowTips) if (r.Rect.HasPoint(local)) { tip = r.Tip; break; }
            if (tip != null) _tip.Render(tip, global, UiScaleMul); else _tip.Hide();
        }
        catch { }
        return saved;
    }

    public void Render(SourceSnapshot snap, Color[] palette, string title)
    {
        if (!IsValid()) return;
        try
        {
            _layer.Visible = true;
            _vp = _c.GetViewportRect().Size;
            float sc = UiTheme.Scale(_vp) * Math.Clamp(UiScaleMul, 0.5f, 4f);
            _w = BaseW * sc;
            float titleH = 26f * sc, rowH = 21f * sc, pad = 8f * sc;

            int players = Math.Max(1, snap.PlayerCount);
            int slot = ViewSlot >= 0 && ViewSlot < players ? ViewSlot : Math.Clamp(snap.LocalSlot, 0, players - 1);
            var ps = slot < snap.PerPlayer.Length ? snap.PerPlayer[slot] : new PlayerSources();
            int turns = Math.Max(1, snap.Rounds);
            var pc = palette[Math.Min(slot, palette.Length - 1)];

            int lc = 0, rc = 0, ic = 0;
            _tabRects.Clear(); _rowTips.Clear();
            int fT = F(15, sc), fR = F(13, sc), fS = F(11, sc), fBig = F(20, sc);
            var dim = new Color(UiTheme.Cream.R, UiTheme.Cream.G, UiTheme.Cream.B, 0.65f);

            // Title bar + ✕
            var tl = L(ref lc, fT, UiTheme.Gold); tl.Text = $"{title}  ·  {turns} turn{(turns == 1 ? "" : "s")}";
            tl.SetPosition(new Vector2(pad, 3f * sc));
            float cs = titleH - 6f * sc;
            _closeRect = new Rect2(_w - cs - 4f * sc, 3f * sc, cs, cs);
            var xl = L(ref lc, fT, UiTheme.Cream); xl.Text = "✕"; xl.HorizontalAlignment = HorizontalAlignment.Center;
            xl.SetPosition(_closeRect.Position); xl.SetSize(_closeRect.Size);
            float y = titleH + 4f * sc;

            // Player tabs (co-op): icon + name in the character color; the selected one is highlighted.
            if (players > 1)
            {
                float tx = pad, tabH = 24f * sc;
                for (int s = 0; s < players; s++)
                {
                    string nm = s < snap.Labels.Length ? snap.Labels[s] : $"P{s + 1}";
                    float tw = Math.Min((_w - pad * 2) / players - 4f * sc, (nm.Length * fR * 0.55f) + 34f * sc);
                    var c = palette[Math.Min(s, palette.Length - 1)];
                    var bg = R(ref rc);
                    bg.Color = s == slot ? new Color(c.R * 0.45f, c.G * 0.45f, c.B * 0.45f, 0.95f) : new Color(1f, 1f, 1f, 0.05f);
                    bg.SetPosition(new Vector2(tx, y)); bg.SetSize(new Vector2(tw, tabH));
                    if (s == slot) { var ul = R(ref rc); ul.Color = c; ul.SetPosition(new Vector2(tx, y + tabH - 2f * sc)); ul.SetSize(new Vector2(tw, 2f * sc)); }
                    float ix = tx + 3f * sc;
                    if (s < snap.PlayerIcons.Length && snap.PlayerIcons[s] is { } ip && Tex(ip) is { } t)
                    { var i = I(ref ic); i.Texture = t; i.SetPosition(new Vector2(ix, y + 2f * sc)); i.SetSize(new Vector2(tabH - 4f * sc, tabH - 4f * sc)); ix += tabH; }
                    var n = L(ref lc, fR, s == slot ? UiTheme.Gold : dim);
                    int maxC = Math.Max(3, (int)((tx + tw - ix) / (fR * 0.55f)));
                    n.Text = nm.Length <= maxC ? nm : nm[..Math.Max(1, maxC - 1)] + "…";
                    n.SetPosition(new Vector2(ix, y + 3f * sc));
                    _tabRects.Add((new Rect2(tx, y, tw, tabH), s));
                    tx += tw + 4f * sc;
                }
                y += tabH + 6f * sc;
            }

            // Totals row
            var stats = new (string Cap, string Val, Color Col)[]
            {
                ("DEALT", MeterRows.Fmt(ps.DealtTotal), pc),
                ("PER TURN", MeterRows.Rate(ps.DealtTotal / (double)turns), pc),
                ("TAKEN", MeterRows.Fmt(ps.TakenTotal), UiTheme.Red),
                ("BLOCKED", MeterRows.Fmt(ps.BlockedTotal), new Color(0.50f, 0.72f, 0.96f)),
                ("RATIO", MeterRows.Ratio(ps.DealtTotal, ps.TakenTotal), UiTheme.Gold),
            };
            float cellW = (_w - pad * 2) / stats.Length;
            for (int i = 0; i < stats.Length; i++)
            {
                float cx = pad + i * cellW;
                var cap = L(ref lc, fS, new Color(stats[i].Col.R, stats[i].Col.G, stats[i].Col.B, 0.8f)); cap.Text = stats[i].Cap; cap.SetPosition(new Vector2(cx, y));
                var val = L(ref lc, fBig, stats[i].Col); val.Text = stats[i].Val; val.SetPosition(new Vector2(cx, y + 13f * sc));
            }
            y += 44f * sc;
            var sub = L(ref lc, fS, dim);
            sub.Text = $"{SubPrefix}Net {MeterRows.Net(ps.DealtTotal - ps.TakenTotal)}  ·  Healed {MeterRows.Fmt(ps.HealTotal)}  ·  Block gained {MeterRows.Fmt(ps.BlockTotal)}  ·  Ratio = dealt ÷ taken";
            sub.SetPosition(new Vector2(pad, y));
            y += 18f * sc;

            // Doom & Poison line (always shown, so it's clear when they did nothing)
            var d = ps.Dots;
            var dp = L(ref lc, fR, DotReader.PoisonColor);
            dp.Text = $"{DotReader.PoisonName} {d.PoisonTotal} ({DotReader.Pct(d.PoisonTotal, ps.DealtTotal)}%)";
            dp.SetPosition(new Vector2(pad, y));
            var dd = L(ref lc, fR, DotReader.DoomColor);
            dd.Text = $"{DotReader.DoomName} {d.DoomTotal} ({DotReader.Pct(d.DoomTotal, ps.DealtTotal)}%, {d.DoomKills} kill{(d.DoomKills == 1 ? "" : "s")})";
            dd.SetPosition(new Vector2(_w * 0.5f, y));
            y += rowH;
            var sv = L(ref lc, fR, Support.VulnColor);
            sv.Text = $"Vulnerable +{MeterRows.Fmt(Support.Get(ps.Support, SupportKind.Vulnerable))}";
            sv.SetPosition(new Vector2(pad, y));
            var sw = L(ref lc, fR, Support.WeakColor);
            sw.Text = $"Weak −{MeterRows.Fmt(Support.Get(ps.Support, SupportKind.Weak))}";
            sw.SetPosition(new Vector2(_w * 0.36f, y));
            var ss = L(ref lc, fR, Support.StrColor);
            ss.Text = $"Str down −{MeterRows.Fmt(Support.Get(ps.Support, SupportKind.StrengthDown))}";
            ss.SetPosition(new Vector2(_w * 0.64f, y));
            _rowTips.Add((new Rect2(pad, y, _w - pad * 2, rowH), MeterRows.SupportTipPublic(title, ps, turns)));
            y += rowH + 4f * sc;

            y = Section(ref lc, ref rc, ref ic, "DAMAGE DEALT", ps.Dealt, ps.DealtTotal, turns, pc, false, DealtRows, y, sc, rowH, pad, d);
            y = Section(ref lc, ref rc, ref ic, "DAMAGE TAKEN", ps.Taken, ps.TakenTotal, turns, UiTheme.Red, true, TakenRows, y + 4f * sc, sc, rowH, pad, null);

            var hint = L(ref lc, fS, new Color(1f, 1f, 1f, 0.45f));
            hint.Text = "Drag to move  ·  hover a bar for details  ·  C = full breakdown";
            hint.SetPosition(new Vector2(pad, y + 2f * sc));
            y += 18f * sc;

            _h = y + pad * 0.5f;
            if (!_posFracInit) { _posFrac = new Vector2(24f * sc / _vp.X, (TopInset(_vp) + 20f * sc) / _vp.Y); _posFracInit = true; }
            float px = Math.Clamp(_posFrac.X * _vp.X, 0f, Math.Max(0f, _vp.X - _w));
            float py = Math.Clamp(_posFrac.Y * _vp.Y, TopInset(_vp), Math.Max(TopInset(_vp), _vp.Y - _h));
            _c.SetPosition(new Vector2(px, py)); _c.SetSize(new Vector2(_w, _h));
            _hit.SetPosition(new Vector2(px, py)); _hit.SetSize(new Vector2(_w, _h));
            _bg.SetPosition(Vector2.Zero); _bg.SetSize(new Vector2(_w, _h));
            _titleBg.SetPosition(Vector2.Zero); _titleBg.SetSize(new Vector2(_w, titleH));
            _titleLine.SetPosition(new Vector2(0, titleH - Math.Max(1f, sc))); _titleLine.SetSize(new Vector2(_w, Math.Max(1f, sc)));
            _barLayer.SetSize(new Vector2(_w, _h));

            for (int i = lc; i < _labels.Count; i++) _labels[i].Visible = false;
            for (int i = rc; i < _rects.Count; i++) _rects[i].Visible = false;
            for (int i = ic; i < _icons.Count; i++) _icons[i].Visible = false;
        }
        catch (Exception ex) { GD.PrintErr($"[STS2 Damage] post-fight render error: {ex.Message}"); }
    }

    private float Section(ref int lc, ref int rc, ref int ic, string head, List<SourceEntry> entries, long total, int turns,
                          Color color, bool taken, int maxRows, float y, float sc, float rowH, float pad, DotTotals? dots)
    {
        var h = L(ref lc, F(12, sc), UiTheme.Gold); h.Text = head; h.SetPosition(new Vector2(pad, y));
        y += 18f * sc;
        if (entries.Count == 0)
        {
            var n = L(ref lc, F(12, sc), new Color(1f, 1f, 1f, 0.5f)); n.Text = "none"; n.SetPosition(new Vector2(pad + 4f * sc, y));
            return y + rowH;
        }
        long top = Math.Max(1, entries[0].Total);
        int shown = Math.Min(entries.Count, maxRows);
        int fR = F(13, sc);
        float bw = _w - pad * 2, bh = rowH - 2f * sc;
        for (int i = 0; i < shown; i++)
        {
            var e = entries[i];
            var kind = taken ? DotKind.None : DotReader.KindOf(e.Name);
            var col = DotReader.ColorOf(kind, color);
            var back = R(ref rc); back.Color = new Color(1f, 1f, 1f, 0.035f);
            back.SetPosition(new Vector2(pad, y)); back.SetSize(new Vector2(bw, bh));
            var bar = R(ref rc); bar.Color = new Color(col.R * 0.78f, col.G * 0.78f, col.B * 0.78f, 0.82f);
            bar.SetPosition(new Vector2(pad, y)); bar.SetSize(new Vector2(Math.Max(1f, bw * e.Total / top), bh));
            var gl = R(ref rc); gl.Color = new Color(1f, 1f, 1f, 0.10f);
            gl.SetPosition(new Vector2(pad, y)); gl.SetSize(new Vector2(Math.Max(1f, bw * e.Total / top), bh * 0.45f));
            float tx = pad + 4f * sc;
            var rk = L(ref lc, fR, UiTheme.Cream); rk.Text = $"{i + 1}."; rk.SetPosition(new Vector2(tx, y)); tx += 17f * sc;
            string? icon = e.Icon ?? DotReader.IconOf(kind);
            if (icon != null && Tex(icon) is { } t) { var im = I(ref ic); im.Texture = t; im.SetPosition(new Vector2(tx, y + 0.5f * sc)); im.SetSize(new Vector2(bh - 1f, bh - 1f)); tx += bh + 2f * sc; }
            string right = $"{MeterRows.Fmt(e.Total)} ({DotReader.Pct(e.Total, total)}%)";
            var rl = L(ref lc, fR, UiTheme.Cream); rl.Text = right; rl.HorizontalAlignment = HorizontalAlignment.Right;
            rl.SetPosition(new Vector2(pad, y)); rl.SetSize(new Vector2(bw - 4f * sc, bh));
            int maxC = Math.Max(4, (int)((bw - (tx - pad) - right.Length * fR * 0.52f - 8f * sc) / (fR * 0.52f)));
            var nl = L(ref lc, fR, UiTheme.Cream); nl.Text = e.Name.Length <= maxC ? e.Name : e.Name[..Math.Max(1, maxC - 1)] + "…";
            nl.SetPosition(new Vector2(tx, y));
            _rowTips.Add((new Rect2(pad, y, bw, bh), MeterRows.SourceTip(e, total, turns, kind, dots, null, taken)));
            y += rowH;
        }
        if (entries.Count > shown)
        {
            var more = L(ref lc, F(11, sc), new Color(1f, 1f, 1f, 0.5f)); more.Text = $"+ {entries.Count - shown} more (C for the full list)";
            more.SetPosition(new Vector2(pad + 4f * sc, y)); y += 16f * sc;
        }
        return y;
    }

    private static int F(int b, float sc) => Math.Max(8, (int)Math.Round(b * sc));

    private Label L(ref int cur, int size, Color color)
    {
        Label l;
        if (cur < _labels.Count) l = _labels[cur];
        else { l = UiTheme.MakeLabel(size, color); _c.AddChild(l); _labels.Add(l); }
        UiTheme.Apply(l, size, color);
        l.HorizontalAlignment = HorizontalAlignment.Left; l.SetSize(Vector2.Zero);
        l.Visible = true; cur++;
        return l;
    }

    private ColorRect R(ref int cur)
    {
        ColorRect r;
        if (cur < _rects.Count) r = _rects[cur];
        else { r = new ColorRect { MouseFilter = Control.MouseFilterEnum.Ignore }; _barLayer.AddChild(r); _rects.Add(r); }
        r.Visible = true; cur++;
        return r;
    }

    private TextureRect I(ref int cur)
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

    private Texture2D? Tex(string path)
    {
        if (_texCache.TryGetValue(path, out var c)) return c;
        Texture2D? tex = null;
        try { if (ResourceLoader.Exists(path)) tex = ResourceLoader.Load<Texture2D>(path, null, ResourceLoader.CacheMode.Reuse); } catch { }
        _texCache[path] = tex;
        return tex;
    }
}
