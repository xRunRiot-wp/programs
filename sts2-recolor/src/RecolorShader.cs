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
uniform sampler2D rc_pic : repeat_enable, filter_linear_mipmap;
uniform float rc_pic_amt = 0.0;
uniform int rc_pic_mode = 0;
uniform float rc_pic_scale = 4.0;
uniform int rc_pic_map = 0;                 // 0 = pinned to the art (UV), 1 = flat over the body
uniform vec2 rc_pic_center = vec2(0.0);     // flat: the body's middle, in local pixels
uniform vec2 rc_pic_stretch = vec2(1.0);
uniform vec2 rc_pic_offset = vec2(0.0);
uniform float rc_pic_rot = 0.0;             // radians
uniform vec2 rc_pic_flip = vec2(1.0);
uniform float rc_pic_repeat = 1.0;
uniform float rc_pic_pixel = 0.0;
uniform vec3 rc_pic_adj = vec3(0.0, 1.0, 1.0); // the picture's own hue shift (turns), saturation, brightness
// Click-to-select: for one frame every part is drawn as a flat, unique ID color (never shown to the player).
uniform float rc_id_on = 0.0;
uniform vec3 rc_id = vec3(0.0);

varying vec4 modulate_color;
varying vec2 local_pos;

void vertex() {
	modulate_color = COLOR;
	local_pos = VERTEX;
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

	// Picture texture, pinned to the art (UV) so it moves and bends with every animation.
	if (rc_pic_amt > 0.001) {
		// Where on the picture this pixel lands, in picture copies (0..1 = one copy).
		vec2 psize = vec2(textureSize(rc_pic, 0));
		vec2 p;
		if (rc_pic_map == 1) {
			// flat: 1000 px of body = one copy at size 1; keeps the picture's own shape; centered on the body
			p = (local_pos - rc_pic_center) / 1000.0 * rc_pic_scale;
			p.y *= psize.x / max(psize.y, 1.0);
		} else {
			p = UV * rc_pic_scale;
		}
		p *= rc_pic_stretch;
		float cr = cos(rc_pic_rot);
		float sr = sin(rc_pic_rot);
		p = vec2(cr * p.x - sr * p.y, sr * p.x + cr * p.y);
		p = p * rc_pic_flip - rc_pic_offset;
		if (rc_pic_map == 1) { p += vec2(0.5); }
		float inside = 1.0;
		if (rc_pic_repeat < 0.5) {
			inside = step(0.0, p.x) * step(p.x, 1.0) * step(0.0, p.y) * step(p.y, 1.0);
		}
		vec4 pic;
		if (rc_pic_pixel > 0.5) {
			ivec2 isz = textureSize(rc_pic, 0);
			ivec2 ip = clamp(ivec2(floor(fract(p) * vec2(isz))), ivec2(0), isz - ivec2(1));
			pic = texelFetch(rc_pic, ip, 0);
		} else {
			pic = texture(rc_pic, p);
		}
		if (any(notEqual(rc_pic_adj, vec3(0.0, 1.0, 1.0)))) {
			vec3 ah = rgb2hsv(pic.rgb);
			ah.x = fract(ah.x + rc_pic_adj.x + 1.0);
			ah.y = clamp(ah.y * rc_pic_adj.y, 0.0, 1.0);
			ah.z = clamp(ah.z * rc_pic_adj.z, 0.0, 1.0);
			pic.rgb = hsv2rgb(ah);
		}
		float a = rc_pic_amt * pic.a * inside;
		vec3 blended;
		if (rc_pic_mode == 0) {
			// Picture colors, keeping this art's own light and shadow.
			vec3 ph = rgb2hsv(pic.rgb);
			float light = clamp(rgb2hsv(outc).z * 1.25, 0.0, 1.0);
			blended = hsv2rgb(vec3(ph.x, ph.y, clamp(ph.z * light, 0.0, 1.0)));
		} else if (rc_pic_mode == 1) {
			// Texture only: the picture's light/dark detail pressed into the existing colors (overlay blend).
			float l = dot(pic.rgb, vec3(0.299, 0.587, 0.114));
			vec3 lo = 2.0 * outc * l;
			vec3 hi = vec3(1.0) - 2.0 * (vec3(1.0) - outc) * (1.0 - l);
			blended = clamp(mix(lo, hi, step(vec3(0.5), outc)), 0.0, 1.0);
		} else if (rc_pic_mode == 2) {
			blended = pic.rgb;                                             // the picture exactly
		} else if (rc_pic_mode == 3) {
			blended = outc * pic.rgb;                                      // multiply (darken)
		} else if (rc_pic_mode == 4) {
			blended = vec3(1.0) - (vec3(1.0) - outc) * (vec3(1.0) - pic.rgb); // screen (lighten)
		} else {
			blended = clamp(outc + pic.rgb, 0.0, 1.0);                    // add (glow)
		}
		outc = mix(outc, blended, a);
	}

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
	if (rc_id_on > 0.5) {
		COLOR = vec4(rc_id, step(0.3, col.a * modulate_color.a));
	}
}
";
}
