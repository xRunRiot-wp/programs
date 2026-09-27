using System;
using System.Collections.Generic;

namespace STS2_DamageCharts;

// A single dealt hit (one damage event) within a round, for the stacked per-attack bar.
internal readonly struct DealtSeg
{
    public readonly int Amount;
    public readonly string? Icon;
    public readonly string Label;
    public DealtSeg(int amount, string? icon, string label) { Amount = amount; Icon = icon; Label = label; }
}

// One source's total contribution (a card name or a power like "Poison").
internal readonly struct SourceEntry
{
    public readonly string Name;
    public readonly long Total;
    public readonly string? Icon; // resource path to a card/relic texture, if any
    public readonly int Hits;     // number of individual hits (for the meter's hover: hits / avg / max)
    public readonly int MaxHit;
    public SourceEntry(string name, long total, string? icon, int hits = 0, int maxHit = 0)
    { Name = name; Total = total; Icon = icon; Hits = hits; MaxHit = maxHit; }
}

// Running total for one source: sum, hit count, biggest single hit.
internal sealed class SourceAcc
{
    public long Total;
    public int Hits;
    public int Max;
    public void Add(long amount, int hits, int max) { Total += amount; Hits += hits; if (max > Max) Max = max; }
}

// One line in the combat log.
internal readonly struct LogEntry
{
    public readonly int Round;
    public readonly string Text;
    public readonly bool Taken;
    public LogEntry(int round, string text, bool taken) { Round = round; Text = text; Taken = taken; }
}

internal sealed class PlayerSources
{
    public List<SourceEntry> Dealt = new();
    public long DealtTotal;
    public List<SourceEntry> Taken = new();
    public long TakenTotal;
    public long HealTotal;   // total HP healed this scope (no by-source breakdown)
    public long BlockTotal;  // total block gained this scope (no by-source breakdown)
    public DotTotals Dots = new(); // dedicated Doom & Poison stats (dealt)
    public long BlockedTotal;      // incoming damage your block actually absorbed
    public int BlockedHits;        // hits that were (at least partly) blocked
}

internal sealed class ChartRow
{
    public readonly int Round;
    public readonly int[] Dealt;
    public readonly int[] Taken;
    public readonly List<DealtSeg>[] DealtSegs; // per slot, ordered individual hits
    public ChartRow(int round, int[] dealt, int[] taken, List<DealtSeg>[] dealtSegs)
    {
        Round = round; Dealt = dealt; Taken = taken; DealtSegs = dealtSegs;
    }
}

internal sealed class ChartSnapshot
{
    public readonly List<ChartRow> Rows;
    public readonly string[] Labels;
    public readonly int PlayerCount;
    public ChartSnapshot(List<ChartRow> rows, string[] labels, int playerCount)
    {
        Rows = rows; Labels = labels; PlayerCount = playerCount;
    }
}

internal sealed class SourceSnapshot
{
    public readonly PlayerSources[] PerPlayer;
    public readonly string[] Labels;
    public readonly int PlayerCount;
    public readonly int LocalSlot;
    public readonly LogEntry[] Log; // most recent lines, oldest-first
    public int Rounds = 1;          // turns in this scope (a fight's rounds, or the run's summed) for per-turn rates
    public string?[] PlayerIcons = Array.Empty<string?>(); // per slot: character icon (top-bar art), like the game's player panel
    public SourceSnapshot(PlayerSources[] perPlayer, string[] labels, int playerCount, int localSlot, LogEntry[] log)
    {
        PerPlayer = perPlayer; Labels = labels; PlayerCount = playerCount; LocalSlot = localSlot; Log = log;
    }
}

// Thread-safe accumulator. Capture writes on the game/main thread; the UI reads immutable snapshots.
internal sealed class DamageTracker
{
    private readonly object _lock = new();
    private readonly Dictionary<(int Round, int Slot), int[]> _rounds = new();   // [0]=dealt [1]=taken
    private readonly Dictionary<int, Dictionary<string, SourceAcc>> _dealtBySource = new();
    private readonly Dictionary<int, Dictionary<string, SourceAcc>> _takenBySource = new();
    private readonly Dictionary<int, DotTotals> _dots = new();
    private readonly Dictionary<int, (long Total, int Hits)> _blocked = new();
    private readonly Dictionary<string, string> _sourceIcon = new(); // source label -> texture resource path
    private readonly Dictionary<(int Round, int Slot), List<DealtSeg>> _dealtSegs = new();
    private readonly Dictionary<int, long> _healByPlayer = new();   // slot -> total healed
    private readonly Dictionary<int, long> _blockByPlayer = new();  // slot -> total block gained
    private readonly List<LogEntry> _log = new();
    private const int LogCap = 500;
    private const int LogShow = 300; // detail panel scrolls through this much history
    private int _maxRound;
    private int _playerCount = 1;
    private int _localSlot;
    private string[] _labels = { "You" };
    private string?[] _playerIcons = Array.Empty<string?>();

    public void Reset(int playerCount, string[] labels, int localSlot, string?[]? playerIcons = null)
    {
        lock (_lock)
        {
            _playerIcons = playerIcons ?? Array.Empty<string?>();
            _rounds.Clear();
            _dealtBySource.Clear();
            _takenBySource.Clear();
            _sourceIcon.Clear();
            _dealtSegs.Clear();
            _healByPlayer.Clear();
            _blockByPlayer.Clear();
            _dots.Clear();
            _blocked.Clear();
            _log.Clear();
            _maxRound = 0;
            CurrentRound = 0;
            _playerCount = Math.Max(1, playerCount);
            _labels = labels;
            _localSlot = Math.Max(0, localSlot);
        }
    }

    public bool HasData()
    {
        lock (_lock) { return _dealtBySource.Count > 0 || _takenBySource.Count > 0 || _blocked.Count > 0; }
    }

    public void AddLog(int round, string text, bool taken)
    {
        lock (_lock)
        {
            _log.Add(new LogEntry(round, text, taken));
            if (_log.Count > LogCap) _log.RemoveRange(0, _log.Count - LogCap);
        }
    }

    // countHit=false for the blocked part of a hit whose HP part is recorded separately (one hit, not two).
    public void AddDealt(int round, int slot, int amount, string source, string? icon = null, bool countHit = true)
        => Add(round, slot, 0, amount, source, _dealtBySource, icon, countHit);

    public void AddTaken(int round, int slot, int amount, string source, string? icon = null)
        => Add(round, slot, 1, amount, source, _takenBySource, icon);

    // Dedicated Doom & Poison bookkeeping (the hit itself is also recorded via AddDealt).
    public void AddDot(int slot, DotKind kind, int amount, bool killed)
    {
        if (kind == DotKind.None || amount <= 0 || slot < 0) return;
        lock (_lock)
        {
            if (!_dots.TryGetValue(slot, out var d)) { d = new DotTotals(); _dots[slot] = d; }
            if (kind == DotKind.Poison)
            {
                d.PoisonTotal += amount; d.PoisonTicks++;
                if (amount > d.PoisonMaxTick) d.PoisonMaxTick = amount;
                if (killed) d.PoisonKills++;
            }
            else
            {
                d.DoomTotal += amount;
                if (killed) d.DoomKills++;
            }
        }
    }

    public void AddBlocked(int slot, int amount)
    {
        if (amount <= 0 || slot < 0) return;
        lock (_lock)
        {
            _blocked.TryGetValue(slot, out var b);
            _blocked[slot] = (b.Total + amount, b.Hits + 1);
        }
    }

    public void AddHealed(int slot, int amount) => AddTotal(_healByPlayer, slot, amount);

    public void AddBlock(int slot, int amount) => AddTotal(_blockByPlayer, slot, amount);

    private void AddTotal(Dictionary<int, long> byPlayer, int slot, int amount)
    {
        if (amount <= 0 || slot < 0) return;
        lock (_lock)
        {
            byPlayer.TryGetValue(slot, out long cur);
            byPlayer[slot] = cur + amount;
        }
    }

    private void Add(int round, int slot, int field, int amount, string source,
                     Dictionary<int, Dictionary<string, SourceAcc>> bySource, string? icon, bool countHit = true)
    {
        if (amount <= 0 || slot < 0) return;
        lock (_lock)
        {
            var key = (round, slot);
            if (!_rounds.TryGetValue(key, out var vals)) { vals = new int[2]; _rounds[key] = vals; }
            vals[field] += amount;
            if (round > _maxRound) _maxRound = round;

            if (!bySource.TryGetValue(slot, out var map)) { map = new Dictionary<string, SourceAcc>(); bySource[slot] = map; }
            if (!map.TryGetValue(source, out var acc)) { acc = new SourceAcc(); map[source] = acc; }
            acc.Add(amount, countHit ? 1 : 0, amount);

            if (icon != null && !_sourceIcon.ContainsKey(source)) _sourceIcon[source] = icon;

            if (field == 0) // dealt: remember the individual hit for the stacked per-attack bar
            {
                if (!_dealtSegs.TryGetValue(key, out var segs)) { segs = new List<DealtSeg>(); _dealtSegs[key] = segs; }
                segs.Add(new DealtSeg(amount, icon, source));
            }
        }
    }

    public ChartSnapshot Snapshot()
    {
        lock (_lock)
        {
            var rows = new List<ChartRow>();
            if (_rounds.Count == 0) return new ChartSnapshot(rows, (string[])_labels.Clone(), _playerCount);
            // Derive the actual round range from recorded data (don't assume rounds start at 1).
            int minR = int.MaxValue, maxR = int.MinValue;
            foreach (var k in _rounds.Keys) { if (k.Round < minR) minR = k.Round; if (k.Round > maxR) maxR = k.Round; }
            for (int r = minR; r <= maxR; r++)
            {
                var dealt = new int[_playerCount];
                var taken = new int[_playerCount];
                var segs = new List<DealtSeg>[_playerCount];
                for (int s = 0; s < _playerCount; s++)
                {
                    if (_rounds.TryGetValue((r, s), out var v)) { dealt[s] = v[0]; taken[s] = v[1]; }
                    segs[s] = _dealtSegs.TryGetValue((r, s), out var ls) ? ls : new List<DealtSeg>(0);
                }
                rows.Add(new ChartRow(r, dealt, taken, segs));
            }
            return new ChartSnapshot(rows, (string[])_labels.Clone(), _playerCount);
        }
    }

    public SourceSnapshot SourceSnapshot()
    {
        lock (_lock)
        {
            var perPlayer = new PlayerSources[_playerCount];
            for (int s = 0; s < _playerCount; s++)
            {
                var ps = new PlayerSources();
                ps.Dealt = SortedList(_dealtBySource, s, out ps.DealtTotal);
                ps.Taken = SortedList(_takenBySource, s, out ps.TakenTotal);
                _healByPlayer.TryGetValue(s, out ps.HealTotal);
                _blockByPlayer.TryGetValue(s, out ps.BlockTotal);
                if (_dots.TryGetValue(s, out var d)) ps.Dots = d.Clone();
                if (_blocked.TryGetValue(s, out var bl)) { ps.BlockedTotal = bl.Total; ps.BlockedHits = bl.Hits; }
                perPlayer[s] = ps;
            }
            int from = Math.Max(0, _log.Count - LogShow);
            var log = _log.GetRange(from, _log.Count - from).ToArray();
            int rounds = Math.Max(1, _maxRound);
            if (CurrentRound > rounds) rounds = CurrentRound;
            return new SourceSnapshot(perPlayer, (string[])_labels.Clone(), _playerCount, _localSlot, log) { Rounds = rounds, PlayerIcons = _playerIcons };
        }
    }

    // Live round number (set by the mod each tick) so per-turn rates count turns with no damage too.
    public int CurrentRound;

    private List<SourceEntry> SortedList(Dictionary<int, Dictionary<string, SourceAcc>> bySource, int slot, out long total)
    {
        total = 0;
        var list = new List<SourceEntry>();
        if (bySource.TryGetValue(slot, out var map))
        {
            foreach (var kv in map)
            {
                _sourceIcon.TryGetValue(kv.Key, out var icon);
                list.Add(new SourceEntry(kv.Key, kv.Value.Total, icon, kv.Value.Hits, kv.Value.Max));
                total += kv.Value.Total;
            }
            list.Sort((a, b) => b.Total.CompareTo(a.Total));
        }
        return list;
    }
}
