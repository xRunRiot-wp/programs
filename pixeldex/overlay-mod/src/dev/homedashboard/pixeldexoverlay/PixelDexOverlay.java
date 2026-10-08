package dev.homedashboard.pixeldexoverlay;

import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.network.event.RegisterPayloadHandlersEvent;

/**
 * PixelDex Structure Overlay: press a key (default ".", rebindable) to see outlines of every nearby structure in the world,
 * with its name -- so you can tell when you're standing in a Graveyard, Haunted Tower, temple... where some Pokémon only
 * spawn (Joseph, 2026-10-08, for ScubaSteve: "overlay for structures ... needs a keyboard shortcut, probably small separate
 * mod for the same version as after pokopia").
 *
 * Only the server knows where structures are, so the client asks for the ones around the player (StructureQuery) and the
 * server answers with their boxes. The payloads are optional: a client or server without this mod still connects.
 */
@Mod(PixelDexOverlay.MODID)
public class PixelDexOverlay {
    public static final String MODID = "pixeldexoverlay";

    public PixelDexOverlay(IEventBus modBus) {
        modBus.addListener((RegisterPayloadHandlersEvent e) -> e.registrar("1").optional()
                .playToServer(StructureQuery.Request.TYPE, StructureQuery.Request.CODEC, StructureQuery.Request::handle)
                .playToClient(StructureQuery.Reply.TYPE, StructureQuery.Reply.CODEC, StructureQuery.Reply::handle));
        if (System.getProperty("pixeldexoverlay.selftest") != null)
            net.neoforged.neoforge.common.NeoForge.EVENT_BUS.addListener(SelfTest::run);
    }
}
