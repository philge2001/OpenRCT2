/*****************************************************************************
 * Copyright (c) 2014-2026 OpenRCT2 developers
 *
 * For a complete list of all authors, please refer to contributors.md
 * Interested in contributing? Visit https://github.com/OpenRCT2/OpenRCT2
 *
 * OpenRCT2 is licensed under the GNU General Public License version 3.
 *****************************************************************************/

#pragma once

#include "GLSLTypes.h"
#include "OpenGLShaderProgram.h"

namespace OpenRCT2::Ui
{
    // Upscales the final RGB screen image to the window size using pixel-art aware edge smoothing.
    class PixelArtUpscaleShader final : public OpenGLShaderProgram
    {
    private:
        GLint uTexture{ -1 };
        GLint uSourceSize{ -1 };

        GLint vPosition{ -1 };
        GLint vTextureCoordinate{ -1 };

        GLuint _vbo{};
        GLuint _vao{};

    public:
        PixelArtUpscaleShader();
        ~PixelArtUpscaleShader() override;

        static void SetTexture(GLuint texture);
        void SetSourceSize(int32_t width, int32_t height);

        void Draw();

    private:
        void GetLocations();
    };
} // namespace OpenRCT2::Ui
