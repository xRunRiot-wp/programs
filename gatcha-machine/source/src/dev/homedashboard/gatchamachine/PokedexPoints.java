package dev.homedashboard.gatchamachine;

import com.pixelmonmod.pixelmon.api.events.CaptureEvent;
import com.pixelmonmod.pixelmon.api.events.EggHatchEvent;
import com.pixelmonmod.pixelmon.api.pokedex.PokeDexStorageProxy;
import com.pixelmonmod.pixelmon.api.pokedex.Pokedex;
import com.pixelmonmod.pixelmon.api.pokedex.PokedexStorage;
import com.pixelmonmod.pixelmon.api.pokedex.StoredPokedex;
import com.pixelmonmod.pixelmon.api.pokedex.event.PokedexEvent;
import com.pixelmonmod.pixelmon.api.pokemon.Pokemon;
import com.pixelmonmod.pixelmon.api.pokemon.PokemonBase;
import com.pixelmonmod.pixelmon.api.pokemon.species.Species;
import com.pixelmonmod.pixelmon.api.pokemon.species.Stats;
import com.pixelmonmod.pixelmon.api.pokemon.species.gender.GenderProperties;
import com.pixelmonmod.pixelmon.api.pokemon.species.palette.PaletteProperties;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;

import java.util.Objects;

/**
 * Points for new Pokedex entries (Pixelmon's own Pokedex, keyed by species + form + palette):
 * a species never seen before = 200, a new form of a known species = 50, a new palette of a known form = 100.
 * One award per registration - the biggest "new" thing wins.
 */
public final class PokedexPoints {
    public static final int NEW_SPECIES = 200, NEW_PALETTE = 100, NEW_FORM = 50, SHINY_CATCH = 500;

    private PokedexPoints() {}

    public static void onPokedex(PokedexEvent.Post e) {
        if (e.getPokedexType() != Pokedex.NATIONAL_DEX) return;
        if (e.getOldStatus() != null && e.getOldStatus().hasSeen()) return;
        if (e.getNewStatus() == null || !e.getNewStatus().hasSeen()) return;
        ServerPlayer player = e.getPlayer();
        Pokemon mon = e.getPokemon();
        if (player == null || mon == null || !GatchaMachine.isUnlocked(player)) return;

        int award = award(PokeDexStorageProxy.getStorageNow(player), mon.toBase());
        if (award <= 0) return;
        GatchaMachine.addPoints(player, award);
        String kind = award == NEW_SPECIES ? "species" : award == NEW_PALETTE ? "palette" : "form";
        player.displayClientMessage(Component.translatable("gatchamachine.dex." + kind, award), true);
    }

    /** Every shiny caught or hatched is worth 500, even a repeat of a species (Adam 10-11). Stacks with the Pokedex bonus. */
    public static void onCapture(CaptureEvent.SuccessfulCapture e) {
        shinyReward(e.getPlayer(), e.getPokemon(), "gatchamachine.shiny");
    }

    public static void onHatch(EggHatchEvent.Post e) {
        shinyReward(e.getPlayer(), e.getPokemon(), "gatchamachine.shiny.hatch");
    }

    private static void shinyReward(ServerPlayer player, Pokemon mon, String message) {
        if (player == null || mon == null || !mon.isShiny() || !GatchaMachine.isUnlocked(player)) return;
        GatchaMachine.addPoints(player, SHINY_CATCH);
        player.sendSystemMessage(Component.translatable(message, SHINY_CATCH));
    }

    /** What the just-registered entry is worth, looking at every OTHER entry of the same species. */
    static int award(PokedexStorage dex, PokemonBase registered) {
        Species species = registered.getSpecies();
        if (dex == null || species == null) return 0;
        boolean speciesKnown = false, formKnown = false;
        for (Stats form : species.getForms()) {
            for (GenderProperties gp : form.getGenderProperties()) {
                for (PaletteProperties pal : gp.getPalettes()) {
                    boolean sameForm = Objects.equals(form.getName(), registered.getFormName());
                    if (sameForm && Objects.equals(pal.getName(), registered.getPaletteName())) continue; // the new entry itself
                    if (!seen(dex, new PokemonBase(species, form, pal, gp.getGender()))) continue;
                    speciesKnown = true;
                    if (sameForm) formKnown = true;
                }
            }
        }
        if (!speciesKnown) return NEW_SPECIES;
        if (!formKnown) return NEW_FORM;
        return NEW_PALETTE;
    }

    static boolean seen(PokedexStorage dex, PokemonBase base) {
        if (dex instanceof StoredPokedex stored) return stored.hasSeen(Pokedex.NATIONAL_DEX, base);
        return dex.hasSeen(base);
    }
}
