import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { Public } from '../common/decorators/public.decorator';
import { OperatorApiKeyGuard } from '../common/guards/operator-api-key.guard';

/**
 * Descarga de la extensión del bot desde la web de operadores.
 *
 * Los zips (uno por panel, con el panel fijo) los genera
 * `scripts/build-extension-per-panel.sh` y quedan en `extension-builds/`, que
 * viaja dentro de la imagen. NO van en `public/`: llevan la clave del bot, y
 * con ella cualquiera podría conectarse como bot y recibir cargas. Por eso se
 * entregan sólo con la clave de operador, igual que el resto del panel.
 */
interface BuildsManifest {
  version: string;
  builtAt: string;
  panels: { slug: string; panelId: string; name: string; file: string }[];
}

const BUILDS_DIR = path.join(process.cwd(), 'extension-builds');

function readManifest(): BuildsManifest | null {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(BUILDS_DIR, 'manifest.json'), 'utf8'),
    ) as BuildsManifest;
  } catch {
    return null;
  }
}

@Controller('operator/extension')
@Public()
@UseGuards(OperatorApiKeyGuard)
export class ExtensionDownloadController {
  /** Versión publicada y paneles disponibles. */
  @Get()
  list() {
    const manifest = readManifest();
    if (!manifest) return { version: null, builtAt: null, panels: [] };
    return {
      version: manifest.version,
      builtAt: manifest.builtAt,
      panels: manifest.panels.map(({ slug, panelId, name }) => ({
        slug,
        panelId,
        name,
      })),
    };
  }

  @Get(':slug/download')
  download(@Param('slug') slug: string, @Res() res: Response) {
    const entry = readManifest()?.panels.find((p) => p.slug === slug);
    // El nombre sale del manifest, nunca del parámetro: sin path traversal.
    const file = entry ? path.join(BUILDS_DIR, path.basename(entry.file)) : null;
    if (!file || !fs.existsSync(file)) {
      throw new NotFoundException('No hay una extensión publicada para ese panel');
    }
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${path.basename(file)}"`,
    );
    res.setHeader('Cache-Control', 'no-store');
    fs.createReadStream(file).pipe(res);
  }
}
