package dev.homedashboard.gatchamachine;

import com.pixelmonmod.pixelmon.api.pokemon.boss.BossTierRegistry;
import com.pixelmonmod.pixelmon.entities.pixelmon.PixelmonEntity;
import net.minecraft.server.level.ServerLevel;
import net.neoforged.neoforge.event.server.ServerStartedEvent;

/** Only with -Dgatchamachine.selftest: check the pools, tiers, sprites and a real boss spawn on a dedicated server. */
final class SelfTest {
    private SelfTest() {}

    static void run(ServerStartedEvent e) {
        String tag = "[gatchamachine selftest] ";
        try {
            System.out.println(tag + "regular pool: " + BossSpin.regularPool().size() + ", ultimate pool: " + BossSpin.ultimatePool().size());
            for (String id : BossSpin.TIERS)
                System.out.println(tag + "tier " + id + ": " + BossTierRegistry.getBossTier(id).map(t -> "ok, extraLevels=" + t.getExtraLevels() + " alwaysPalette=" + t.getAlwaysPalette()).orElse("MISSING"));
            StringBuilder ult = new StringBuilder();
            for (BossSpin.Choice c : BossSpin.ultimatePool()) ult.append(BossSpin.displayName(c)).append(", ");
            System.out.println(tag + "ultimates: " + ult);
            var tier = BossTierRegistry.getBossTier("ultimate").orElseThrow();
            BossSpin.Choice first = BossSpin.ultimatePool().get(0);
            System.out.println(tag + "sample reel entry: " + BossSpin.entry(first, BossSpin.paletteFor(first, tier)));
            System.out.println(tag + "never-encountered cost with 10 of 50 seen: " + BossSpin.neverEncounteredCost(40, 50));

            var rid = net.minecraft.resources.ResourceLocation.fromNamespaceAndPath(GatchaMachine.MODID, "gatcha_machine");
            System.out.println(tag + "recipe: " + (e.getServer().getRecipeManager().byKey(rid).isPresent() ? "ok" : "MISSING"));
            System.out.println(tag + "advancement: " + (e.getServer().getAdvancements().get(GatchaMachine.ADVANCEMENT) != null ? "ok" : "MISSING"));

            ServerLevel level = e.getServer().overworld();
            var spawn = level.getSharedSpawnPos();
            var mon = com.pixelmonmod.pixelmon.api.pokemon.PokemonBuilder.builder().species(first.species()).form(first.form())
                    .palette(BossSpin.paletteFor(first, tier)).level(60).build();
            PixelmonEntity ent = mon.getOrSpawnPixelmon(level, spawn.getX() + 0.5, level.getHeight(net.minecraft.world.level.levelgen.Heightmap.Types.MOTION_BLOCKING, spawn.getX(), spawn.getZ()), spawn.getZ() + 0.5);
            ent.setBossTier(tier);
            System.out.println(tag + "spawned " + ent.getPokemon().getSpecies().getName() + " form=" + ent.getPokemon().getForm().getName()
                    + " palette=" + ent.getPokemon().getPalette().getName() + " boss=" + ent.getBossTier().getID() + " lvl=" + ent.getPokemon().getPokemonLevel()
                    + " alive=" + ent.isAlive() + " inWorld=" + (level.getEntity(ent.getUUID()) != null));
            System.out.println(tag + "PASS");
        } catch (Throwable t) {
            System.out.println(tag + "FAIL " + t);
            t.printStackTrace(System.out);
        }
    }
}
