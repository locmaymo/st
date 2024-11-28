import process from 'node:process';
import fs from 'node:fs';
import webpack from 'webpack';
import middleware from 'webpack-dev-middleware';
import { publicLibConfig } from '../../webpack.config.js';

export default function getWebpackServeMiddleware() {
    const compiler = webpack(publicLibConfig);

    if (process.env.NODE_ENV === 'production' || process.platform === 'android') {
        compiler.hooks.done.tap('serve', () => {
            if (compiler.watching) {
                compiler.watching.close(() => { });
            }
            compiler.watchFileSystem = null;
            compiler.watchMode = false;
        });
    }

    return middleware(compiler, {
        // @ts-ignore Use actual file system to ease on heap memory usage
        outputFileSystem: fs,
    });
}
