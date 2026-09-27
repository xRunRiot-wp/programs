using System;
using System.Collections.Generic;

namespace STS2_DamageCharts;

// Run-scoped accumulator: folds each finished combat's per-combat snapshot into run-wide totals,
// by-source breakdowns, a per-encounter chart, and a combat log. Emits the SAME ChartSnapshot /
// SourceSnapshot types the per-combat views consume, so the existing renderer is reused unchanged.
//
// Touched only on the game thread (Fold at combat end; the snapshot getters from the per-frame Tick),
// so unlike DamageTracker it needs no lock.
internal sealed class RunAggregate
{
    private const int LogCap = 2000; // run-wide; larger than the per-combat cap since it spans many fights

    private int _playerCount;
    private int _localSlot;
    private string[] _labels = Array.Empty<string>();
    private string?[] _playerIcons = Array.Empty<string?>();

    private long[] _dealt = Array.Empty<long>();
    private long[] _taken = Array.Empty<long>();
    private long[] _heal = Array.Empty<long>();
    private long[] _block = Array.Empty<long>();
    private Dictionary<string, SourceAcc>[] _dealtBySource = Array.Empty<Dictionary<string, SourceAcc>>();
    private Dictionary<string, SourceAcc>[] _takenBySource = Array.Empty<Dictionary<string, SourceAcc>>();
    private DotTotals[] _dots = Array.Empty<DotTotals>();
    private long[] _blockedT = Array.Empty<long>();
    private int[] _blockedH = Array.Empty<int>();
    private int _rounds; // turns summed over every folded fight
    private readonly Dictionary<string, string> _sourceIcon = new();

    private readonly List<int[]> _encDealt = new(); // per encounter: dealt[slot]
    private readonly List<int[]> _encTaken = new(); // per encounter: taken[slot]
    private readonly List<long[]> _encHeal = new(); // per encounter: heal[slot]
    private readonly List<long[]> _encBlock = new();// per encounter: block[slot]
    private readonly List<LogEntry> _log = new();
    private int _encounters;

    public bool HasData() => _encounters > 0;

    // One finished combat's totals for a given player slot, for the in-combat run-history band.
    public readonly struct EncounterStat
    {
        public readonly int Fight;
        public readonly long Dealt, Taken, Heal, Block;
        public EncounterStat(int fight, long dealt, long taken, long heal, long block)
        { Fight = fight; Dealt = dealt; Taken = taken; Heal = heal; Block = block; }
    }

    public List<EncounterStat> EncounterStats(int slot)
    {
        var list = new List<EncounterStat>();
        if (slot < 0 || slot >= _playerCount) return list;
        for (int i = 0; i < _encDealt.Count; i++)
            list.Add(new EncounterStat(i + 1, _encDealt[i][slot], _encTaken[i][slot], _encHeal[i][slot], _encBlock[i][slot]));
        return list;
    }

    public void Clear()
    {
        _playerCount = 0;
        _localSlot = 0;
        _labels = Array.Empty<string>();
        _dealt = _taken = _heal = _block = Array.Empty<long>();
        _dealtBySource = _takenBySource = Array.Empty<Dictionary<string, SourceAcc>>();
        _dots = Array.Empty<DotTotals>();
        _blockedT = Array.Empty<long>(); _blockedH = Array.Empty<int>();
        _rounds = 0;
        _sourceIcon.Clear();
        _encDealt.Clear();
        _encTaken.Clear();
        _encHeal.Clear();
        _encBlock.Clear();
        _log.Clear();
        _encounters = 0;
    }

    // Add one finished combat. Reads the per-combat snapshots taken before the tracker is reset.
    public void Fold(SourceSnapshot src, ChartSnapshot chart)
    {
        if (src.PlayerCount <= 0) return;
        if (_playerCount != src.PlayerCount) Init(src);

        _encounters++;
        _rounds += Math.Max(1, src.Rounds);
        var encD = new int[_playerCount];
        var encT = new int[_playerCount];
        var encH = new long[_playerCount];
        var encB = new long[_playerCount];
        for (int s = 0; s < _playerCount && s < src.PerPlayer.Length; s++)
        {
            var ps = src.PerPlayer[s];
            if (ps == null) continue;
            _dealt[s] += ps.DealtTotal;
            _taken[s] += ps.TakenTotal;
            _heal[s] += ps.HealTotal;
            _block[s] += ps.BlockTotal;
            _dots[s].Add(ps.Dots);
            _blockedT[s] += ps.BlockedTotal; _blockedH[s] += ps.BlockedHits;
            Merge(_dealtBySource[s], ps.Dealt);
            Merge(_takenBySource[s], ps.Taken);
            encD[s] = (int)Math.Min(int.MaxValue, ps.DealtTotal);
            encT[s] = (int)Math.Min(int.MaxValue, ps.TakenTotal);
            encH[s] = ps.HealTotal;
            encB[s] = ps.BlockTotal;
        }
        _encDealt.Add(encD);
        _encTaken.Add(encT);
        _encHeal.Add(encH);
        _encBlock.Add(encB);

        _log.Add(new LogEntry(_encounters, $"──── Fight {_encounters} ────", false));
        foreach (var e in src.Log) _log.Add(e);
        if (_log.Count > LogCap) _log.RemoveRange(0, _log.Count - LogCap);
    }

    private void Init(SourceSnapshot src)
    {
        _playerCount = src.PlayerCount;
        _localSlot = Math.Clamp(src.LocalSlot, 0, _playerCount - 1);
        _labels = (string[])src.Labels.Clone();
        _playerIcons = src.PlayerIcons;
        _dealt = new long[_playerCount];
        _taken = new long[_playerCount];
        _heal = new long[_playerCount];
        _block = new long[_playerCount];
        _dealtBySource = new Dictionary<string, SourceAcc>[_playerCount];
        _takenBySource = new Dictionary<string, SourceAcc>[_playerCount];
        _dots = new DotTotals[_playerCount];
        _blockedT = new long[_playerCount]; _blockedH = new int[_playerCount];
        for (int s = 0; s < _playerCount; s++)
        {
            _dealtBySource[s] = new Dictionary<string, SourceAcc>();
            _takenBySource[s] = new Dictionary<string, SourceAcc>();
            _dots[s] = new DotTotals();
        }
    }

    private void Merge(Dictionary<string, SourceAcc> into, List<SourceEntry> entries)
    {
        foreach (var e in entries)
        {
            if (!into.TryGetValue(e.Name, out var acc)) { acc = new SourceAcc(); into[e.Name] = acc; }
            acc.Add(e.Total, e.Hits, e.MaxHit);
            if (e.Icon != null && !_sourceIcon.ContainsKey(e.Name)) _sourceIcon[e.Name] = e.Icon;
        }
    }

    // Run so far PLUS the fight in progress (the meter's "Run" segment while in combat). Folding is
    // done into throwaway copies so the real aggregate only changes at combat end.
    public SourceSnapshot RunWithLive(SourceSnapshot live)
    {
        if (!HasData() || _playerCount != live.PlayerCount) return HasData() ? RunSourceSnapshot() : live;
        var run = RunSourceSnapshot();
        var perPlayer = new PlayerSources[_playerCount];
        for (int s = 0; s < _playerCount; s++)
        {
            var a = run.PerPlayer[s]; var b = live.PerPlayer[s];
            var ps = new PlayerSources
            {
                Dealt = MergeLists(a.Dealt, b.Dealt, out long dt),
                Taken = MergeLists(a.Taken, b.Taken, out long tt),
                HealTotal = a.HealTotal + b.HealTotal,
                BlockTotal = a.BlockTotal + b.BlockTotal,
                Dots = a.Dots.Clone(),
                BlockedTotal = a.BlockedTotal + b.BlockedTotal,
                BlockedHits = a.BlockedHits + b.BlockedHits,
            };
            ps.Dots.Add(b.Dots);
            ps.DealtTotal = dt; ps.TakenTotal = tt;
            perPlayer[s] = ps;
        }
        return new SourceSnapshot(perPlayer, run.Labels, _playerCount, _localSlot, run.Log) { Rounds = run.Rounds + Math.Max(1, live.Rounds), PlayerIcons = live.PlayerIcons.Length > 0 ? live.PlayerIcons : run.PlayerIcons };
    }

    private static List<SourceEntry> MergeLists(List<SourceEntry> a, List<SourceEntry> b, out long total)
    {
        var map = new Dictionary<string, SourceAcc>();
        var icons = new Dictionary<string, string?>();
        foreach (var e in a) { if (!map.TryGetValue(e.Name, out var x)) { x = new SourceAcc(); map[e.Name] = x; icons[e.Name] = e.Icon; } x.Add(e.Total, e.Hits, e.MaxHit); }
        foreach (var e in b) { if (!map.TryGetValue(e.Name, out var x)) { x = new SourceAcc(); map[e.Name] = x; icons[e.Name] = e.Icon; } x.Add(e.Total, e.Hits, e.MaxHit); icons[e.Name] ??= e.Icon; }
        total = 0;
        var list = new List<SourceEntry>();
        foreach (var kv in map) { list.Add(new SourceEntry(kv.Key, kv.Value.Total, icons[kv.Key], kv.Value.Hits, kv.Value.Max)); total += kv.Value.Total; }
        list.Sort((x, y) => y.Total.CompareTo(x.Total));
        return list;
    }

    public SourceSnapshot RunSourceSnapshot()
    {
        var perPlayer = new PlayerSources[_playerCount];
        for (int s = 0; s < _playerCount; s++)
        {
            var ps = new PlayerSources
            {
                Dealt = SortedList(_dealtBySource[s], out long dt),
                Taken = SortedList(_takenBySource[s], out long tt),
                HealTotal = _heal[s],
                BlockTotal = _block[s],
                Dots = _dots[s].Clone(),
                BlockedTotal = _blockedT[s],
                BlockedHits = _blockedH[s],
            };
            ps.DealtTotal = dt;
            ps.TakenTotal = tt;
            perPlayer[s] = ps;
        }
        return new SourceSnapshot(perPlayer, (string[])_labels.Clone(), _playerCount, _localSlot, _log.ToArray()) { Rounds = Math.Max(1, _rounds), PlayerIcons = _playerIcons };
    }

    // Per-encounter chart: one row per combat, with the combat's dealt/taken totals. The "Round" field
    // carries the 1-based encounter index; one dealt segment per slot so the bar renders at full height.
    public ChartSnapshot RunChartSnapshot()
    {
        var rows = new List<ChartRow>(_encDealt.Count);
        for (int i = 0; i < _encDealt.Count; i++)
        {
            var dealt = _encDealt[i];
            var taken = _encTaken[i];
            var segs = new List<DealtSeg>[_playerCount];
            for (int s = 0; s < _playerCount; s++)
                segs[s] = new List<DealtSeg> { new DealtSeg(dealt[s], null, "") };
            rows.Add(new ChartRow(i + 1, dealt, taken, segs));
        }
        return new ChartSnapshot(rows, (string[])_labels.Clone(), _playerCount);
    }

    private List<SourceEntry> SortedList(Dictionary<string, SourceAcc> map, out long total)
    {
        total = 0;
        var list = new List<SourceEntry>();
        foreach (var kv in map)
        {
            _sourceIcon.TryGetValue(kv.Key, out var icon);
            list.Add(new SourceEntry(kv.Key, kv.Value.Total, icon, kv.Value.Hits, kv.Value.Max));
            total += kv.Value.Total;
        }
        list.Sort((a, b) => b.Total.CompareTo(a.Total));
        return list;
    }
}
