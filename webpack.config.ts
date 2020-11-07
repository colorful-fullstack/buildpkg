import path from 'path'

module.exports = {
    entry: './src/index.ts',
    output: {
        path: path.resolve(__dirname, process.env.dist ?? 'dist'),
        filename: 'index.js'
    },
    mode: process.env.prod ? 'production' : 'development',
    devtool: process.env.prod ? 'source-map' : 'cheap-module-source-map',
    target: 'web',
    module: {
        rules: [
            {
                test: /\.ts(x?)$/,
                exclude: /node_modules/,
                use: [
                    {
                        loader: 'ts-loader',
                    },
                ],
            }
        ],
    },
    resolve: {
        extensions: ['.ts', '.js', '.tsx', '.json'],
        alias: {
            '@dist': path.join(__dirname, 'dist'),
            '@src': path.join(__dirname, '/src'),
        },
    },
    plugins: [
    ]
}
