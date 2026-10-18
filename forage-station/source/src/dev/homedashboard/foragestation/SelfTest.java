package dev.homedashboard.foragestation;

import com.pixelmonmod.pixelmon.api.pokemon.Pokemon;
import com.pixelmonmod.pixelmon.api.pokemon.PokemonBuilder;
import com.pixelmonmod.pixelmon.api.registries.PixelmonSpecies;
import com.pixelmonmod.pixelmon.api.world.WorldTime;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.ResourceKey;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.levelgen.Heightmap;
import net.neoforged.neoforge.capabilities.Capabilities;
import net.neoforged.neoforge.event.server.ServerStartedEvent;

import java.util.ArrayList;
import java.util.List;
import java.util.TreeMap;
import java.util.UUID;

/** Only with -Dforagestation.selftest: place a station, put a Pokemon in, forage, pull items out, break it. */
final class SelfTest {
    private SelfTest() {}

    static void run(ServerStartedEvent e) {
        String tag = "[foragestation selftest] ";
        try {
            var server = e.getServer();
            System.out.println(tag + "loot entries: " + ForageLoot.entries().size());
            var biomes = server.registryAccess().registryOrThrow(Registries.BIOME);
            for (String b : new String[]{"minecraft:plains", "minecraft:desert", "minecraft:ocean", "minecraft:flower_forest", "minecraft:nether_wastes", "minecraft:snowy_plains"}) {
                var h = biomes.getHolderOrThrow(ResourceKey.create(Registries.BIOME, ResourceLocation.parse(b)));
                List<Double> w = new ArrayList<>();
                List<ItemStack> c = ForageLoot.candidates(h, true, List.of(WorldTime.DAY), w);
                List<Double> wn = new ArrayList<>();
                int night = ForageLoot.candidates(h, true, List.of(WorldTime.NIGHT), wn).size();
                StringBuilder sb = new StringBuilder();
                for (int i = 0; i < Math.min(8, c.size()); i++) sb.append(c.get(i).getItem()).append(' ');
                System.out.println(tag + b + ": " + c.size() + " items by day, " + night + " at night; e.g. " + sb);
            }
            for (int sp : new int[]{0, 50, 100, 200, 400}) System.out.println(tag + "speed " + sp + " -> " + ForageLoot.cooldownTicks(sp) + " ticks");

            ServerLevel level = server.overworld();
            var spawn = level.getSharedSpawnPos();
            int y = level.getHeight(Heightmap.Types.MOTION_BLOCKING_NO_LEAVES, spawn.getX() + 3, spawn.getZ());
            BlockPos pos = new BlockPos(spawn.getX() + 3, y, spawn.getZ());
            level.setBlockAndUpdate(pos, ForageStation.STATION.get().defaultBlockState());
            var be = (StationBlockEntity) level.getBlockEntity(pos);
            System.out.println(tag + "placed station at " + pos + " biome " + level.getBiome(pos).unwrapKey().orElseThrow().location()
                    + " be=" + (be != null) + " recipe=" + server.getRecipeManager().byKey(ResourceLocation.fromNamespaceAndPath(ForageStation.MODID, "forage_station")).isPresent());

            Pokemon mon = PokemonBuilder.builder().species(PixelmonSpecies.get("Jolteon").orElseThrow().getValueUnsafe()).level(50).build();
            UUID owner = UUID.fromString("00000000-0000-0000-0000-0000000f0a6e");
            be.insert(mon, owner, "TestOwner", true);
            System.out.println(tag + "inserted " + be.pokemon().getDisplayName().getString() + " speed " + mon.getStats().getSpeed()
                    + " cooldown " + be.cooldown() + " photo " + be.photo().getItem() + " " + be.photo().getComponents().size() + " components");

            // round trip through save/load, as after a world restart
            var reg = level.registryAccess();
            var saved = be.saveWithFullMetadata(reg);
            var be2 = new StationBlockEntity(pos, be.getBlockState());
            be2.setLevel(level);
            be2.loadWithComponents(saved, reg);
            System.out.println(tag + "reload: pokemon=" + (be2.pokemon() != null ? be2.pokemon().getDisplayName().getString() : "LOST")
                    + " sameUUID=" + (be2.pokemon() != null && be2.pokemon().getUUID().equals(mon.getUUID())) + " owner=" + be2.ownerName());
            var client = be.getUpdateTag(reg);
            System.out.println(tag + "client sync tag keys: " + client.getAllKeys() + " size " + client.toString().length());

            TreeMap<String, Integer> found = new TreeMap<>();
            int tries = 400, got = 0;
            for (int i = 0; i < tries; i++) {
                ItemStack s = be.forageOnce(be.pokemon());
                if (!s.isEmpty()) { got++; found.merge(s.getItem().toString(), s.getCount(), Integer::sum); }
            }
            System.out.println(tag + "forage " + tries + " tries -> " + got + " finds: " + found);
            be.items().clearContent();
            int ticks = 0;
            int before = count(be);
            while (count(be) == before && ticks < 2000) { be.serverTick(); ticks++; }
            System.out.println(tag + "first timed find after " + ticks + " ticks (cooldown " + ForageLoot.cooldownTicks(mon.getStats().getSpeed()) + ")");

            var cap = level.getCapability(Capabilities.ItemHandler.BLOCK, pos, Direction.DOWN);
            ItemStack pulled = ItemStack.EMPTY;
            if (cap != null) for (int i = 0; i < cap.getSlots() && pulled.isEmpty(); i++) pulled = cap.extractItem(i, 64, false);
            be.forageOnce(be.pokemon());
            System.out.println(tag + "hopper capability=" + (cap != null) + " pulled " + pulled);

            int pend = Returns.pendingCount(server);
            level.setBlockAndUpdate(pos, Blocks.AIR.defaultBlockState());
            System.out.println(tag + "broken: pending returns " + pend + " -> " + Returns.pendingCount(server) + " (owner offline, waits for login)");
            var drops = level.getEntitiesOfClass(net.minecraft.world.entity.item.ItemEntity.class, new net.minecraft.world.phys.AABB(pos).inflate(2));
            System.out.println(tag + "dropped item stacks: " + drops.size());
            drops.forEach(net.minecraft.world.entity.Entity::discard);
            System.out.println(tag + "PASS");
        } catch (Throwable t) {
            System.out.println(tag + "FAIL " + t);
            t.printStackTrace(System.out);
        }
    }

    private static int count(StationBlockEntity be) {
        int n = 0;
        for (int i = 0; i < StationBlockEntity.SLOTS; i++) n += be.items().getItem(i).getCount();
        return n;
    }
}
