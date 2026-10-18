package dev.homedashboard.foragestation;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.pixelmonmod.pixelmon.api.world.WorldTime;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Holder;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.tags.TagKey;
import net.minecraft.util.RandomSource;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.level.biome.Biome;

import java.io.InputStreamReader;
import java.io.Reader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/**
 * Pixelmon's own Forage loot list (data/pixelmon/spawning/forage/loot/forage_loot.set.json, so datapack edits count too):
 * which items can be found in which biomes, at what time of day, with or without open sky, and how common each one is.
 */
public final class ForageLoot {
    private ForageLoot() {}

    static final ResourceLocation FILE = ResourceLocation.fromNamespaceAndPath("pixelmon", "spawning/forage/loot/forage_loot.set.json");

    record Cond(List<ResourceLocation> biomeIds, List<TagKey<Biome>> biomeTags, Boolean seesSky, Set<String> times) {
        boolean matches(Holder<Biome> biome, boolean sky, List<WorldTime> now) {
            if (!biomeIds.isEmpty() || !biomeTags.isEmpty()) {
                boolean hit = biome.unwrapKey().map(k -> biomeIds.contains(k.location())).orElse(false);
                for (TagKey<Biome> t : biomeTags) hit |= biome.is(t);
                if (!hit) return false;
            }
            if (seesSky != null && seesSky != sky) return false;
            if (!times.isEmpty() && now.stream().noneMatch(t -> times.contains(t.name()))) return false;
            return true;
        }
    }

    record Mult(double multiplier, Cond cond) {}

    public record Entry(Item item, int count, double rarity, Cond cond, Cond anti, List<Mult> mults) {
        double weight(Holder<Biome> biome, boolean sky, List<WorldTime> now) {
            if (cond != null && !cond.matches(biome, sky, now)) return 0;
            if (anti != null && anti.matches(biome, sky, now)) return 0;
            double w = rarity;
            for (Mult m : mults) if (m.cond().matches(biome, sky, now)) w *= m.multiplier();
            return w;
        }
    }

    private static List<Entry> entries = List.of();

    public static List<Entry> entries() { return entries; }

    /** Load (or reload) the list from the server's data packs; falls back to the copy inside the Pixelmon jar. */
    public static void load(MinecraftServer server) {
        List<Entry> out = new ArrayList<>();
        try {
            var res = server.getResourceManager().getResource(FILE);
            Reader r = res.isPresent() ? res.get().openAsReader()
                    : new InputStreamReader(com.pixelmonmod.pixelmon.Pixelmon.class.getResourceAsStream("/data/pixelmon/spawning/forage/loot/forage_loot.set.json"), StandardCharsets.UTF_8);
            try (r) {
                JsonObject root = JsonParser.parseReader(r).getAsJsonObject();
                for (JsonElement si : root.getAsJsonArray("spawnInfos")) collect(si.getAsJsonObject(), out);
            }
        } catch (Exception e) {
            System.out.println("[foragestation] could not read Pixelmon's forage list: " + e);
        }
        entries = out;
        System.out.println("[foragestation] forage items loaded: " + out.size());
    }

    private static void collect(JsonObject o, List<Entry> out) {
        if (o.has("collection")) { for (JsonElement c : o.getAsJsonArray("collection")) collect(c.getAsJsonObject(), out); return; }
        if (!o.has("item")) return;                                  // Pokemon encounters are left out: the station only gathers items
        JsonObject it = o.getAsJsonObject("item");
        Item item = BuiltInRegistries.ITEM.get(ResourceLocation.parse(it.get("itemID").getAsString()));
        if (item == Items.AIR) return;
        int count = it.has("quantity") ? it.get("quantity").getAsInt() : 1;
        double rarity = o.has("rarity") ? o.get("rarity").getAsDouble() : 1;
        List<Mult> mults = new ArrayList<>();
        if (o.has("rarityMultipliers")) for (JsonElement m : o.getAsJsonArray("rarityMultipliers")) {
            JsonObject mo = m.getAsJsonObject();
            mults.add(new Mult(mo.get("multiplier").getAsDouble(), cond(mo.getAsJsonObject("condition"))));
        }
        out.add(new Entry(item, count, rarity, o.has("condition") ? cond(o.getAsJsonObject("condition")) : null,
                o.has("anticondition") ? cond(o.getAsJsonObject("anticondition")) : null, mults));
    }

    private static Cond cond(JsonObject c) {
        List<ResourceLocation> ids = new ArrayList<>();
        List<TagKey<Biome>> tags = new ArrayList<>();
        if (c != null && c.has("biomes")) for (JsonElement b : c.getAsJsonArray("biomes")) {
            String s = b.getAsString();
            if (s.startsWith("#")) tags.add(TagKey.create(Registries.BIOME, ResourceLocation.parse(s.substring(1))));
            else ids.add(ResourceLocation.parse(s));
        }
        Boolean sky = c != null && c.has("seesSky") ? c.get("seesSky").getAsBoolean() : null;
        Set<String> times = new java.util.HashSet<>();
        if (c != null && c.has("times")) for (JsonElement t : (JsonArray) c.get("times")) times.add(t.getAsString().toUpperCase());
        return new Cond(ids, tags, sky, times);
    }

    /** What could be found at this spot right now, with weights. */
    public static List<ItemStack> candidates(Holder<Biome> biome, boolean sky, List<WorldTime> now, List<Double> weights) {
        List<ItemStack> out = new ArrayList<>();
        for (Entry e : entries) {
            double w = e.weight(biome, sky, now);
            if (w > 0) { out.add(new ItemStack(e.item(), e.count())); weights.add(w); }
        }
        return out;
    }

    public static ItemStack roll(ServerLevel level, BlockPos pos, RandomSource rand) {
        return roll(level.getBiome(pos), level.canSeeSky(pos.above()), WorldTime.getCurrent(level), rand);
    }

    public static ItemStack roll(Holder<Biome> biome, boolean sky, List<WorldTime> now, RandomSource rand) {
        List<Double> w = new ArrayList<>();
        List<ItemStack> c = candidates(biome, sky, now, w);
        double total = 0;
        for (double d : w) total += d;
        if (total <= 0) return ItemStack.EMPTY;
        double pick = rand.nextDouble() * total;
        for (int i = 0; i < c.size(); i++) if ((pick -= w.get(i)) < 0) return c.get(i);
        return c.get(c.size() - 1);
    }

    /**
     * Time between tries. Pixelmon's Forage has a 500-tick (25 s) cooldown; like its other speed-based move skills
     * (Dig: 15 s down to 7.5 s at 200 Speed), faster Pokemon wait less: 25 s at 0 Speed down to 12.5 s at 200+ Speed.
     */
    public static int cooldownTicks(int speed) {
        int s = Math.max(0, Math.min(200, speed));
        return 500 - s * 250 / 200;
    }
}
