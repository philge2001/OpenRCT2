#version 330 core

// clang-format off
const int MASK_REMAP_COUNT          = 3;
const int FLAG_NO_TEXTURE           = (1 << 2);
const int FLAG_MASK                 = (1 << 3);
const int FLAG_CROSS_HATCH          = (1 << 4);
const int FLAG_TTF_TEXT             = (1 << 5);

uniform usampler2DArray uTexture;
uniform usampler2D      uPaletteTex;

uniform sampler2D       uPeelingTex;
uniform bool            uPeeling;

in vec4 gl_FragCoord;

flat in int             fFlags;
flat in uint            fColour;
flat in vec4            fTexColour;
flat in vec4            fTexMask;
flat in vec3            fPalettes;

flat in vec2            fPosition;
in vec3                 fPeelPos;
flat in float           fZoom;
flat in int             fTexColourAtlas;
flat in int             fTexMaskAtlas;
flat in int             fScreenHeight;
// clang-format on

out uint oColour;

uniform sampler2D       uPaletteRgb;
uniform bool            uPixelArtZoom;

flat in vec2            fSpriteSize;

// BEGIN pixel-art zoom
// Smooths sprites that are magnified (zoomed in closer than 1:1), using the
// same xBR edge rules as pixelartupscale.frag. It works on palette indices,
// so it picks one of the neighbouring colours rather than blending, and it
// treats pixels outside the sprite or transparent as their own colour so
// that silhouettes are smoothed too.
const mat3 kRgbToYuv = mat3(
    0.299, -0.169,  0.500,
    0.587, -0.331, -0.419,
    0.114,  0.500, -0.081);
const float kEqualThreshold = 0.6;
const float kTransparentDistance = 100.0;
// Only smooth edges with at least this much contrast, so that textures such
// as grass or foliage keep their look and only real outlines are smoothed.
const float kMinEdgeContrast = 8.0;

ivec2 gXbrTexel;
ivec2 gXbrDirection;

uint SpriteTexel(int x, int y)
{
    ivec2 p = gXbrTexel + ivec2(x, y) * gXbrDirection;
    if (any(lessThan(p, ivec2(0))) || any(greaterThanEqual(p, ivec2(fSpriteSize))))
    {
        return 0u;
    }
    return texelFetch(uTexture, ivec3(ivec2(fTexColour.xy) + p, fTexColourAtlas), 0).r;
}

float XbrDist(uint a, uint b)
{
    if (a == b)
        return 0.0;
    if (a == 0u || b == 0u)
        return kTransparentDistance;
    vec3 colourA = texelFetch(uPaletteRgb, ivec2(int(a), 0), 0).rgb;
    vec3 colourB = texelFetch(uPaletteRgb, ivec2(int(b), 0), 0).rgb;
    vec3 d = abs(kRgbToYuv * (colourA - colourB));
    return 48.0 * d.x + 7.0 * d.y + 6.0 * d.z;
}

bool XbrEq(uint a, uint b)
{
    return XbrDist(a, b) < kEqualThreshold;
}

// spritePos: position inside the sprite in source pixels (fractional).
uint PixelArtZoomTexel(vec2 spritePos)
{
    gXbrTexel = ivec2(floor(spritePos));
    vec2 fp = fract(spritePos);
    gXbrDirection = ivec2(fp.x >= 0.5 ? 1 : -1, fp.y >= 0.5 ? 1 : -1);
    vec2 uv = vec2(gXbrDirection.x > 0 ? fp.x : 1.0 - fp.x, gXbrDirection.y > 0 ? fp.y : 1.0 - fp.y);

    uint E = SpriteTexel(0, 0);
    uint B = SpriteTexel(0, -1);
    uint C = SpriteTexel(1, -1);
    uint D = SpriteTexel(-1, 0);
    uint F = SpriteTexel(1, 0);
    uint G = SpriteTexel(-1, 1);
    uint H = SpriteTexel(0, 1);
    uint I = SpriteTexel(1, 1);
    uint F4 = SpriteTexel(2, 0);
    uint I4 = SpriteTexel(2, 1);
    uint H5 = SpriteTexel(0, 2);
    uint I5 = SpriteTexel(1, 2);

    float wdAntiDiagonal = XbrDist(E, C) + XbrDist(E, G) + XbrDist(I, F4) + XbrDist(I, H5) + 4.0 * XbrDist(H, F);
    float wdDiagonal = XbrDist(H, D) + XbrDist(H, I5) + XbrDist(F, I4) + XbrDist(F, B) + 4.0 * XbrDist(E, I);

    bool edge = wdAntiDiagonal < wdDiagonal && !XbrEq(E, F) && !XbrEq(E, H)
        && ((!XbrEq(F, B) && !XbrEq(H, D)) || (XbrEq(E, I) && !XbrEq(F, I4) && !XbrEq(H, I5)) || XbrEq(E, G)
            || XbrEq(E, C));
    if (!edge)
        return E;

    float distFG = XbrDist(F, G);
    float distHC = XbrDist(H, C);
    bool shallow = 2.0 * distFG <= distHC && !XbrEq(E, G) && !XbrEq(D, G);
    bool steep = 2.0 * distHC <= distFG && !XbrEq(E, C) && !XbrEq(B, C);

    bool inCorner = uv.x + uv.y > 1.5 || (shallow && uv.x + 2.0 * uv.y > 2.0) || (steep && 2.0 * uv.x + uv.y > 2.0);
    if (!inCorner)
        return E;

    uint cornerColour = XbrDist(E, F) <= XbrDist(E, H) ? F : H;
    // Never cut into an opaque pixel: neighbouring sprites (e.g. terrain
    // tiles) are smoothed separately, and cutting would open gaps between them.
    // Also require the two pixels forming the edge to match; in noisy
    // textures they rarely do, while along real outlines they almost always do.
    if (cornerColour == 0u || XbrDist(E, cornerColour) < kMinEdgeContrast || !XbrEq(F, H))
        return E;
    return cornerColour;
}
// END pixel-art zoom

void main()
{
    if (uPeeling)
    {
        float peel = texture(uPeelingTex, fPeelPos.xy).r;
        if (peel == 0.0 || fPeelPos.z >= peel)
        {
            discard;
        }
    }

    vec2 fragCoord = vec2(floor(gl_FragCoord.x), fScreenHeight - floor(gl_FragCoord.y) - 1);
    vec2 position = (fragCoord - fPosition) * fZoom;

    uint texel;
    if ((fFlags & FLAG_NO_TEXTURE) == 0)
    {
        float colourU = (fTexColour.x + position.x) / fTexColour.z;
        float colourV = (fTexColour.y + position.y) / fTexColour.w;
        if (uPixelArtZoom && fZoom < 1.0 && (fFlags & (FLAG_TTF_TEXT | FLAG_MASK)) == 0)
        {
            // Sample at the centre of the output pixel for sub-pixel accuracy.
            texel = PixelArtZoomTexel((fragCoord + 0.5 - fPosition) * fZoom);
        }
        else
        {
            texel = texture(uTexture, vec3(colourU, colourV, fTexColourAtlas)).r;
        }
        if (texel == 0u)
        {
            discard;
        }
        if ((fFlags & FLAG_TTF_TEXT) == 0)
        {
            texel += fColour;
        }
        else
        {
            uint hint_thresh = uint(fFlags & 0xff00) >> 8;
            if (hint_thresh > 0u)
            {
                bool solidColor = texel > 180u;
                texel = (texel > hint_thresh) ? fColour : 0u;
                texel = texel << 8;
                if (solidColor)
                {
                    texel += 1u;
                }
            }
            else
            {
                texel = fColour;
            }
        }
    }
    else
    {
        texel = fColour;
    }

    int paletteCount = fFlags & MASK_REMAP_COUNT;
    if (paletteCount >= 3 && texel >= 0x2Eu && texel < 0x3Au)
    {
        texel = texture(uPaletteTex, vec2(texel + 0xC5u, fPalettes.z) / 256.0f).r;
    }
    else if (paletteCount >= 2 && texel >= 0xCAu && texel < 0xD6u)
    {
        texel = texture(uPaletteTex, vec2(texel + 0x29u, fPalettes.y) / 256.f).r;
    }
    else if (paletteCount >= 1)
    {
        texel = texture(uPaletteTex, vec2(texel, fPalettes.x) / 256.f).r;
    }

    if (texel == 0u)
    {
        discard;
    }

    if ((fFlags & FLAG_CROSS_HATCH) != 0)
    {
        int posSum = int(position.x) + int(position.y);
        if ((posSum % 2) != 0)
        {
            discard;
        }
    }

    if ((fFlags & FLAG_MASK) != 0)
    {
        float maskU = (fTexMask.x + position.x) / fTexMask.z;
        float maskV = (fTexMask.y + position.y) / fTexMask.w;
        uint mask = texture(uTexture, vec3(maskU, maskV, fTexMaskAtlas)).r;
        if (mask == 0u)
        {
            discard;
        }
    }

    oColour = texel;
}
