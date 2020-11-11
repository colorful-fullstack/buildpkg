#!/usr/bin/env node

import path from 'path';
import yargs from 'yargs';
import fs from 'fs';
import { exit, openStdin } from 'process';
import shell from 'shelljs';
import readline from 'n-readlines';

interface Arguments {
    [x: string]: unknown;
    dirty?: boolean;
    force?: boolean;
    dir: string;
    chroot: string;
    repo: string;
    repoName: string;
    pacman: string;
}

const args: Arguments = yargs.options({
    "dirty": { type: 'boolean', description: "use makepkg", required: false },
    'dir': { type: 'string', demandOption: "", description: "set build dir", required: true },
    "force": { type: 'boolean', description: "force", required: false, default: false },
    'chroot': { type: 'string', description: "set chroot dir", required: true },
    "repo": { type: 'string', description: "set repo dir", required: true },
    "repoName": { type: 'string', description: "set repo name", required: true },
    "pacman": { type: 'string', description: "set pacman config file", required: true }
}).argv;

function initChroot() {
    shell.exec(`mkarchroot ${args.chroot}/root base-devel`);
}

function updateRepo() {
    shell.exec(`arch-nspawn -C ${args.pacman} ${args.chroot}/root pacman -Syy`)
}

function checkVersion(path: string): boolean {
    process.chdir(path)
    shell.exec(`makepkg -o -d`, { silent: true });

    const fileStream = new readline(`${path}/PKGBUILD`);
    let pkgver = "";
    let pkgname = "";
    let next: Buffer | false;
    while (next = fileStream.next()) {
        if (pkgver.length !== 0 && pkgname.length !== 0) {
            break;
        }

        const line = next.toString();
        if (line.startsWith("pkgver")) {
            pkgver = line.slice(7, line.length);
            continue;
        }
        if (line.startsWith("pkgname")) {
            pkgname = line.slice(8, line.length);
            continue;
        }
    }

    const stdout = shell.exec(`pacman -Q ${pkgname}`, {silent: true}).stdout;
    return `${pkgname} ${pkgver}-1` !== stdout.replace(/\n/g, '');;
}

function uploadgit() {

}

function registPackage(filePath: string) {
    process.chdir(args.repo);
    const files = fs.readdirSync(filePath);
    let zstList: string[] = [];
    files.forEach((file: string) => {
        if (path.extname(file) === ".zst") {
            zstList.push(file);
        }
    });
    process.chdir(args.repo)
    zstList.forEach((file: string) => {
        if (!fs.existsSync(`${args.repo}/${file}`)) {
            fs.copyFileSync(`${filePath}/${file}`, `${args.repo}/${file}`);
            shell.exec(`gpg --detach-sign ${file}`);
            if (shell.exec(`repo-add -R -p ${args.repoName}.db.tar.gz ${file}`).code !== 0) {
                fs.rmSync(file);
                fs.rmSync(`${file}.sig`);
                throw ("cannot register package");
            }
        }
    });
}

function cleanPackageDir(dir: string) {
    const list = fs.readdirSync(dir);
    list.forEach((file: string) => {
        if (path.extname(file) === ".zst") {
            fs.rmSync(`${dir}/${file}`);
        }
    });

    if (fs.existsSync(`${dir}/src`)) {
        fs.rmdirSync(`${dir}/src`)
    }
}

function build(path: string): boolean {
    if (!checkVersion(path)) {
        return false;
    }

    process.chdir(path);
    shell.exec(`git checkout -- .`);
    shell.exec(`git pull -f`);
    if (args.dirty ?? false) {
        return shell.exec(`makepkg -s`).code == 0;
    }
    else {
        return shell.exec(`makechrootpkg -u -c -r ${args.chroot} -C ${args.pacman}`).code == 0;
    }
}

if (!fs.existsSync(args.chroot)) {
    fs.mkdirSync(args.chroot);
    initChroot();
}

if (!fs.existsSync(args.repo)) {
    fs.mkdirSync(args.repo);
}

updateRepo();

const repoList: string[] = fs.readdirSync(args.dir);

if (!repoList.length) {
    throw ("no repo");
    exit(-1);
}

let isOnlyPackge = false;

for (let file of repoList) {
    if (file === "PKGBUILD") {
        isOnlyPackge = true;
        break;
    }
}

interface TaskResult {
    repo: string;
    path: string;
    result: boolean;
}

function* generate() {
    for (let repo of repoList) {
        const path = `${args.dir}/${repo}`;
        if (!fs.lstatSync(path).isDirectory()) {
            continue;
        }
        yield (): TaskResult => {
            cleanPackageDir(path);
            const result = build(path);
            return {
                repo,
                path,
                result
            }
        }
    }
}

if (isOnlyPackge) {
    cleanPackageDir(args.dir);
    build(args.dir);
    registPackage(args.dir);
    exit(0);
}
