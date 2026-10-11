package dev.homedashboard.gatchamachine;

import com.pixelmonmod.pixelmon.api.pokedex.PokeDexStorageProxy;
import com.pixelmonmod.pixelmon.api.pokedex.Pokedex;
import com.pixelmonmod.pixelmon.api.pokedex.PokedexStorage;
import com.pixelmonmod.pixelmon.api.pokedex.StoredPokedex;
import com.pixelmonmod.pixelmon.api.pokemon.Pokemon;
import com.pixelmonmod.pixelmon.api.pokemon.PokemonBase;
import com.pixelmonmod.pixelmon.api.pokemon.PokemonBuilder;
import com.pixelmonmod.pixelmon.api.pokemon.boss.BossTier;
import com.pixelmonmod.pixelmon.api.pokemon.boss.BossTierRegistry;
import com.pixelmonmod.pixelmon.api.pokemon.species.Species;
import com.pixelmonmod.pixelmon.api.pokemon.species.Stats;
import com.pixelmonmod.pixelmon.api.pokemon.species.gender.GenderProperties;
import com.pixelmonmod.pixelmon.api.pokemon.species.palette.PaletteProperties;
import com.pixelmonmod.pixelmon.api.registries.PixelmonSpecies;
import com.pixelmonmod.pixelmon.api.storage.StorageProxy;
import com.pixelmonmod.pixelmon.entities.pixelmon.PixelmonEntity;
import net.minecraft.core.BlockPos;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.util.RandomSource;
import net.minecraft.world.phys.Vec3;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.UUID;

/** Picks the boss for a spin, builds the reel the client animates, and spawns the boss when the reel stops. */
public final class BossSpin {
    public static final String[] TIERS = {"rare", "epic", "legendary", "ultimate"};
    public static final int[] COSTS = {2250, 4500, 6750, 9000};
    public static final int ULTIMATE = 3;
    public static final int REEL_LENGTH = 48, WINNER_INDEX = 41;
    /** Ticks between the spin starting and the boss appearing; matches the client's reel animation. */
    public static final int SPAWN_DELAY = 150;

    /** One boss option: species + form; palette chosen at spawn. */
    public record Choice(Species species, Stats form) {}

    private record Pending(UUID player, Choice choice, BossTier tier, int cost, long dueTick) {}

    private static final List<Pending> PENDING = new ArrayList<>();
    private static List<Choice> regularPool, ultimatePool;

    private BossSpin() {}

    /** Rare/Epic/Legendary: any regular species (no legendaries/mythicals/Ultra Beasts), default form. */
    static List<Choice> regularPool() {
        if (regularPool == null) {
            List<Choice> out = new ArrayList<>();
            for (Species s : PixelmonSpecies.getAll()) {
                if (s.getDex() <= 0 || s.isLegendary() || s.isMythical() || s.isUltraBeast()) continue;
                out.add(new Choice(s, s.getDefaultForm()));
            }
            regularPool = out;
        }
        return regularPool;
    }

    /** Ultimate: every Mega and Primal form of every species. */
    static List<Choice> ultimatePool() {
        if (ultimatePool == null) {
            List<Choice> out = new ArrayList<>();
            for (Species s : PixelmonSpecies.getAll()) {
                if (s.getDex() <= 0) continue;
                for (Stats f : s.getForms()) {
                    if (f.isMegaForm() || f.getName().toLowerCase().contains("primal")) out.add(new Choice(s, f));
                }
            }
            ultimatePool = out;
        }
        return ultimatePool;
    }

    /** Ultimate bosses this player has never seen (any palette) according to Pixelmon's Pokedex. */
    static List<Choice> neverEncountered(ServerPlayer p) {
        PokedexStorage dex = PokeDexStorageProxy.getStorageNow(p);
        List<Choice> out = new ArrayList<>();
        for (Choice c : ultimatePool()) if (!encountered(dex, c)) out.add(c);
        return out;
    }

    static boolean encountered(PokedexStorage dex, Choice c) {
        if (dex == null) return false;
        for (GenderProperties gp : c.form().getGenderProperties()) {
            for (PaletteProperties pal : gp.getPalettes()) {
                PokemonBase base = new PokemonBase(c.species(), c.form(), pal, gp.getGender());
                if (PokedexPoints.seen(dex, base)) return true;
                if (dex instanceof StoredPokedex stored) {
                    try { if (stored.hasSeen(Pokedex.MEGA_DEX, base)) return true; } catch (RuntimeException ignored) {}
                }
            }
        }
        return false;
    }

    /** Never-encountered price: 9000 plus 0% (nothing seen yet) up to ~100% (only one left). */
    public static int neverEncounteredCost(int unseen, int total) {
        if (total <= 0) return COSTS[ULTIMATE];
        double seenFraction = (total - unseen) / (double) total;
        return (int) Math.round(COSTS[ULTIMATE] * (1 + seenFraction));
    }

    /** Server side of the "Open" button. Returns false (with a message) if the spin can't happen. */
    public static boolean spin(ServerPlayer p, int tierIndex, boolean neverEncountered) {
        if (tierIndex < 0 || tierIndex >= TIERS.length) return false;
        if (!GatchaMachine.isUnlocked(p)) return fail(p, "gatchamachine.locked");
        for (Pending pending : PENDING) if (pending.player().equals(p.getUUID())) return fail(p, "gatchamachine.busy");
        BossTier tier = BossTierRegistry.getBossTier(TIERS[tierIndex]).orElse(null);
        if (tier == null) return fail(p, "gatchamachine.notier");

        List<Choice> pool = tierIndex == ULTIMATE ? ultimatePool() : regularPool();
        int cost = COSTS[tierIndex];
        List<Choice> winners = pool;
        if (neverEncountered && tierIndex == ULTIMATE) {
            winners = neverEncountered(p);
            if (winners.isEmpty()) return fail(p, "gatchamachine.allseen");
            cost = neverEncounteredCost(winners.size(), pool.size());
        }
        if (pool.isEmpty()) return fail(p, "gatchamachine.notier");
        if (GatchaMachine.getPoints(p) < cost) return fail(p, "gatchamachine.poor");

        RandomSource rng = p.getRandom();
        Choice winner = winners.get(rng.nextInt(winners.size()));
        String palette = paletteFor(winner, tier);
        List<Network.ReelEntry> reel = new ArrayList<>(REEL_LENGTH);
        for (int i = 0; i < REEL_LENGTH; i++) {
            Choice c = i == WINNER_INDEX ? winner : pool.get(rng.nextInt(pool.size()));
            reel.add(entry(c, i == WINNER_INDEX ? palette : paletteFor(c, tier)));
        }

        GatchaMachine.addPoints(p, -cost);
        PENDING.add(new Pending(p.getUUID(), winner, tier, cost, p.server.getTickCount() + SPAWN_DELAY));
        Network.sendSpin(p, tierIndex, reel, GatchaMachine.getPoints(p));
        return true;
    }

    private static boolean fail(ServerPlayer p, String key) {
        p.displayClientMessage(Component.translatable(key), true);
        return false;
    }

    /** Legendary/Ultimate tiers are always shiny in Pixelmon's boss config; use that palette when the form has it. */
    static String paletteFor(Choice c, BossTier tier) {
        String always = tier.getAlwaysPalette();
        if (always != null && !always.isEmpty()) {
            for (GenderProperties gp : c.form().getGenderProperties()) if (gp.getPalette(always) != null) return always;
        }
        return c.form().getFirstGenderProperties().getDefaultPalette().getName();
    }

    static Network.ReelEntry entry(Choice c, String palette) {
        GenderProperties gp = c.form().getFirstGenderProperties();
        PaletteProperties pal = gp.getPalette(palette);
        if (pal == null) pal = gp.getDefaultPalette();
        return new Network.ReelEntry(pal.getSprite().toString(), displayName(c));
    }

    static String displayName(Choice c) {
        String name = c.species().getNameTranslation().getString();
        String form = c.form().getName();
        if (form == null || form.isEmpty() || c.species().isDefaultForm(c.form())) return name;
        String f = form.toLowerCase();
        if (f.equals("mega")) return "Mega " + name;
        if (f.startsWith("mega")) return "Mega " + name + " " + form.substring(4).toUpperCase();
        if (f.equals("primal")) return "Primal " + name;
        return name + " (" + Character.toUpperCase(form.charAt(0)) + form.substring(1) + ")";
    }

    public static void tickPending(MinecraftServer server) {
        if (PENDING.isEmpty()) return;
        long now = server.getTickCount();
        for (Iterator<Pending> it = PENDING.iterator(); it.hasNext(); ) {
            Pending pending = it.next();
            if (now < pending.dueTick()) continue;
            ServerPlayer p = server.getPlayerList().getPlayer(pending.player());
            if (p == null) continue; // offline: spawns when they're back
            it.remove();
            try {
                spawn(p, pending.choice(), pending.tier());
            } catch (RuntimeException ex) {
                GatchaMachine.addPoints(p, pending.cost()); // refund if Pixelmon refuses the spawn
                p.sendSystemMessage(Component.translatable("gatchamachine.spawnfailed"));
                ex.printStackTrace();
            }
        }
    }

    /** Spawns the boss a few blocks in front of the player at their party's level plus the tier's extra levels. */
    public static PixelmonEntity spawn(ServerPlayer p, Choice c, BossTier tier) {
        int partyLevel = 5;
        try { partyLevel = Math.max(5, StorageProxy.getPartyNow(p).getHighestLevel()); } catch (RuntimeException ignored) {}
        int level = Math.min(100, (int) Math.round(partyLevel * tier.getLevelMultiplier()) + tier.getExtraLevels());

        Pokemon mon = PokemonBuilder.builder().species(c.species()).form(c.form()).palette(paletteFor(c, tier)).level(level).build();
        Vec3 pos = spawnPos(p);
        PixelmonEntity entity = mon.getOrSpawnPixelmon(p.level(), pos.x, pos.y, pos.z);
        entity.setBossTier(tier);
        p.sendSystemMessage(Component.translatable("gatchamachine.spawned", Component.literal(displayName(c)), Component.translatable(tier.getName())));
        return entity;
    }

    static Vec3 spawnPos(ServerPlayer p) {
        ServerLevel level = p.serverLevel();
        Vec3 look = p.getLookAngle().multiply(1, 0, 1);
        if (look.lengthSqr() < 1e-4) look = new Vec3(0, 0, 1);
        Vec3 target = p.position().add(look.normalize().scale(5));
        BlockPos bp = BlockPos.containing(target);
        for (int dy = 2; dy >= -3; dy--) {
            BlockPos at = bp.above(dy);
            if (level.getBlockState(at).isAir() && level.getBlockState(at.above()).isAir() && !level.getBlockState(at.below()).isAir())
                return new Vec3(target.x, at.getY(), target.z);
        }
        return p.position();
    }
}
