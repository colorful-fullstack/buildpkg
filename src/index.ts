#!/usr/bin/env node

import path from 'path';
import yargs from 'yargs';
import fs from 'fs';
import { exit, openStdin } from 'process';
import shell from 'shelljs';

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
    shell.exec(`arch-nspawn -C ${args.pacman} ${args.chroot}/root pacman -Syyu`)
}

function uploadgit() {

}

function registPackage(filePath: string) {
    process.chdir(args.repo);
    const files = fs.readdirSync(filePath);
    let zstList: string[] = [];
    files.forEach((file: string) => {
        if (path.extname(file) === ".zst") {
            zstList.push(file)
        }
    });
    process.chdir(args.repo)
    zstList.forEach((file: string) => {
        fs.copyFileSync(`${filePath}/${file}`, `${args.repo}/${file}`)
        shell.exec(`gpg --detach-sign ${file}`);
        if (shell.exec(`repo-add -R -p ${args.repoName}.db.tar.gz ${file}`).code !== 0) {
            fs.rmSync(file);
            fs.rmSync(`${file}.sig`)
            throw("cannot register package");
        }
    });
}

function cleanPackageDir(path: string) {

}

function build(path: string): boolean {
    process.chdir(path);
    shell.exec(`git checkout -- .`);
    shell.exec(`git pull -f`);
    if (args.dirty ?? false) {
        return shell.exec(`makepkg -s`).code == 0;
    }
    else {
        return shell.exec(`makechrootpkg -u -c -r ${args.chroot} -C pacman`).code == 0;
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
    build(args.dir);
    registPackage(args.dir);
    exit(0);
}

const repoTasks = generate();
while (true) {
    const result = repoTasks.next();
    if (result.done) {
        break;
    }
    const value = result.value();
    if (!value.result && !args.force) {
        throw (`${value.repo} not build success!`);
        exit(-1);
    }
    if (value.result) {
        registPackage(value.path);
    }
}
