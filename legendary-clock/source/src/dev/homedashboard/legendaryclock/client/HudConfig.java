package dev.homedashboard.legendaryclock.client;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import net.neoforged.fml.loading.FMLPaths;

import java.nio.file.Files;
import java.nio.file.Path;

/** The on-screen timer's settings (per computer, not per world): shown or not, and where. Saved in config/legendaryclock-client.json. */
public final class HudConfig {
    private HudConfig() {}

    private static final Path FILE = FMLPaths.CONFIGDIR.get().resolve("legendaryclock-client.json");
    public static boolean shown = true;
    /** Top-left corner of the timer box, in GUI pixels. */
    public static int x = 4, y = 44;            // just under the Biome Compass icon
    private static boolean loaded;

    public static void load() {
        if (loaded) return;
        loaded = true;
        try {
            if (!Files.exists(FILE)) return;
            JsonObject o = new Gson().fromJson(Files.readString(FILE), JsonObject.class);
            if (o.has("shown")) shown = o.get("shown").getAsBoolean();
            if (o.has("x")) x = o.get("x").getAsInt();
            if (o.has("y")) y = o.get("y").getAsInt();
        } catch (Exception ignored) {
            // A broken file just means default settings.
        }
    }

    public static void save() {
        JsonObject o = new JsonObject();
        o.addProperty("shown", shown);
        o.addProperty("x", x);
        o.addProperty("y", y);
        try {
            Files.writeString(FILE, o.toString());
        } catch (Exception ignored) {
        }
    }
}
