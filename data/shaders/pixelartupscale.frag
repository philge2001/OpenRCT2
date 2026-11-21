#version 330 core

// Pixel-art upscaler for the final screen image.
//
// Uses the edge detection rules of the xBR ("scale by rules") family of
// algorithms by Hyllian, evaluated continuously so that it works at any
// (including non-integer) scale factor. Each output pixel looks at the
// source pixel it falls in and at the corner of that pixel it is closest
// to. If the 5x5 neighbourhood shows an edge running past that corner, the
// corner is filled with the neighbouring colour along a 45, ~27 or ~63
// degree line, which turns staircase edges into smooth lines. The line
// itself is anti-aliased over one output pixel; everything else stays sharp.

uniform sampler2D uTexture;
uniform vec2 uSourceSize;

in vec2 fTextureCoordinate;

out vec4 oColour;

const mat3 kRgbToYuv = mat3(
    0.299, -0.169,  0.500,
    0.587, -0.331, -0.419,
    0.114,  0.500, -0.081);

// Colours closer than this (in weighted YUV distance) are treated as equal.
const float kEqualThreshold = 0.6;

ivec2 gTexel;
ivec2 gDirection;
ivec2 gMaxTexel;

vec3 Fetch(int x, int y)
{
    ivec2 coord = clamp(gTexel + ivec2(x, y) * gDirection, ivec2(0), gMaxTexel);
    return texelFetch(uTexture, coord, 0).rgb;
}

float Dist(vec3 a, vec3 b)
{
    vec3 d = abs(kRgbToYuv * (a - b));
    return 48.0 * d.x + 7.0 * d.y + 6.0 * d.z;
}

bool Eq(vec3 a, vec3 b)
{
    return Dist(a, b) < kEqualThreshold;
}

void main()
{
    vec2 pos = fTextureCoordinate * uSourceSize;
    gTexel = ivec2(floor(pos));
    gMaxTexel = ivec2(uSourceSize) - 1;
    vec2 fp = fract(pos);

    // Size of one output pixel in source pixels, used to anti-alias the edge.
    // Computed before any branching, as derivatives need uniform control flow.
    float px = max(fwidth(pos.x), fwidth(pos.y));

    // Mirror the neighbourhood so that the corner we are closest to is always
    // the bottom-right one, at (1, 1) in local coordinates.
    gDirection = ivec2(fp.x >= 0.5 ? 1 : -1, fp.y >= 0.5 ? 1 : -1);
    vec2 uv = vec2(gDirection.x > 0 ? fp.x : 1.0 - fp.x, gDirection.y > 0 ? fp.y : 1.0 - fp.y);

    //      B  C
    //   D  E  F  F4
    //   G  H  I  I4
    //      H5 I5
    vec3 E = Fetch(0, 0);
    vec3 B = Fetch(0, -1);
    vec3 C = Fetch(1, -1);
    vec3 D = Fetch(-1, 0);
    vec3 F = Fetch(1, 0);
    vec3 G = Fetch(-1, 1);
    vec3 H = Fetch(0, 1);
    vec3 I = Fetch(1, 1);
    vec3 F4 = Fetch(2, 0);
    vec3 I4 = Fetch(2, 1);
    vec3 H5 = Fetch(0, 2);
    vec3 I5 = Fetch(1, 2);

    // Weighted edge strength along each diagonal through the corner.
    float wdAntiDiagonal = Dist(E, C) + Dist(E, G) + Dist(I, F4) + Dist(I, H5) + 4.0 * Dist(H, F);
    float wdDiagonal = Dist(H, D) + Dist(H, I5) + Dist(F, I4) + Dist(F, B) + 4.0 * Dist(E, I);

    bool edge = wdAntiDiagonal < wdDiagonal && !Eq(E, F) && !Eq(E, H)
        && ((!Eq(F, B) && !Eq(H, D)) || (Eq(E, I) && !Eq(F, I4) && !Eq(H, I5)) || Eq(E, G) || Eq(E, C));

    if (!edge)
    {
        oColour = vec4(E, 1.0);
        return;
    }

    float distFG = Dist(F, G);
    float distHC = Dist(H, C);
    bool shallow = 2.0 * distFG <= distHC && !Eq(E, G) && !Eq(D, G);
    bool steep = 2.0 * distHC <= distFG && !Eq(E, C) && !Eq(B, C);

    float mask = smoothstep(-px, px, uv.x + uv.y - 1.5);
    if (shallow)
        mask = max(mask, smoothstep(-1.5 * px, 1.5 * px, uv.x + 2.0 * uv.y - 2.0));
    if (steep)
        mask = max(mask, smoothstep(-1.5 * px, 1.5 * px, 2.0 * uv.x + uv.y - 2.0));

    vec3 cornerColour = Dist(E, F) <= Dist(E, H) ? F : H;
    oColour = vec4(mix(E, cornerColour, mask), 1.0);
}
