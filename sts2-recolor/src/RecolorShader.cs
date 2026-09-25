namespace SpireRecolor;

internal static class RecolorShader
{
	public const int MaxSwaps = 8;

	// h/s/v are kept (same names and math as the game's res://shaders/hsv.gdshader) so the game's own
	// per-monster hue variants still work when it writes "h" onto our material.
	public const string Code = @"
shader_type canvas_item;

uniform float h = 1.0;
uniform float s = 1.0;
uniform float v = 1.0;

uniform float rc_hue = 0.0;
uniform float rc_sat = 1.0;
uniform float rc_bright = 1.0;
uniform float rc_contrast = 1.0;
uniform vec3 rc_tint_hsv = vec3(0.0, 0.0, 1.0);
uniform float rc_tint_amt = 0.0;
uniform int rc_swap_count = 0;
uniform vec4 rc_src[8];
uniform vec4 rc_dst[8];

varying vec4 modulate_color;

void vertex() {
	modulate_color = COLOR;
}

vec3 rgb2hsv(vec3 c) {
	vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
	vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
	vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
	float d = q.x - min(q.w, q.y);
	float e = 1.0e-10;
	return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 hsv2rgb(vec3 c) {
	vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
	vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
	return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void fragment() {
	vec4 col = texture(TEXTURE, UV);
	vec3 base = rgb2hsv(col.rgb);
	vec3 outc = col.rgb;

	// Each pixel goes to the swap whose source color it is closest to (relative to that swap's range),
	// so a wide red swap cannot steal orange pixels that a gold swap is also asking for.
	float best_nd = 1e9;
	float best_w = 0.0;
	vec3 best_mapped = outc;
	for (int i = 0; i < 8; i++) {
		if (i >= rc_swap_count) { break; }
		vec3 src = rc_src[i].xyz;
		vec3 dst = rc_dst[i].xyz;
		float r = max(rc_src[i].w, 0.01);
		float w;
		float nd;
		vec3 mapped;
		if (src.y > 0.12) {
			float dh = abs(base.x - src.x);
			dh = min(dh, 1.0 - dh);
			float tol = r * 0.35;
			nd = dh / tol;
			w = 1.0 - smoothstep(tol * 0.55, tol, dh);
			w *= smoothstep(0.04, 0.14, base.y);
			w *= smoothstep(0.015, 0.06, base.z);
			mapped = vec3(fract(dst.x + (base.x - src.x) + 1.0),
				clamp(base.y * dst.y / max(src.y, 0.05), 0.0, 1.0),
				clamp(base.z * dst.z / max(src.z, 0.05), 0.0, 1.0));
		} else {
			float tol = r * 0.6;
			float dd = distance(vec2(base.y, base.z), vec2(src.y, src.z));
			nd = dd / tol;
			w = 1.0 - smoothstep(tol * 0.55, tol, dd);
			w *= 1.0 - smoothstep(0.15, 0.3, base.y);
			mapped = vec3(dst.x,
				clamp(dst.y + (base.y - src.y), 0.0, 1.0),
				clamp(dst.z + (base.z - src.z), 0.0, 1.0));
		}
		if (w > 0.001 && nd < best_nd) {
			best_nd = nd;
			best_w = w;
			best_mapped = hsv2rgb(mapped);
		}
	}
	outc = mix(outc, best_mapped, best_w);

	vec3 hv = rgb2hsv(outc);
	hv.x = fract(hv.x + rc_hue + 1.0);
	hv.y = clamp(hv.y * rc_sat, 0.0, 1.0);
	outc = hsv2rgb(hv);
	outc = (outc - 0.5) * rc_contrast + 0.5;
	outc = clamp(outc * rc_bright, 0.0, 1.0);

	vec3 tinted = hsv2rgb(vec3(rc_tint_hsv.x, rc_tint_hsv.y, rgb2hsv(outc).z * rc_tint_hsv.z));
	outc = mix(outc, tinted, rc_tint_amt);

	mat3 RGB_to_YIQ = mat3(
		vec3(0.2989,  0.5959,  0.2115),
		vec3(0.5870, -0.2774, -0.5229),
		vec3(0.1140, -0.3216,  0.3114));
	vec3 yiq = RGB_to_YIQ * outc;
	float hue = mix(0.0, 6.283185, 1.0 - h);
	float sh = sin(hue);
	float ch = cos(hue);
	yiq *= mat3(vec3(1.0, 0.0, 0.0), vec3(0.0, ch, -sh), vec3(0.0, sh, ch));
	yiq = mat3(vec3(1.0, 0.0, 0.0), vec3(0.0, s, 0.0), vec3(0.0, 0.0, s)) * yiq;
	yiq = mix(vec3(0.0), yiq, v);
	outc = inverse(RGB_to_YIQ) * yiq;

	COLOR = vec4(outc, col.a) * modulate_color;
}
";
}
