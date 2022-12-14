#!/usr/bin/env node

import { globby } from 'globby'
import * as cp from 'child_process'
import * as path from 'path'
import * as fs from 'node:fs/promises'

if (process.argv.length < 4) {
    throw 'Usage: node compress-vid.js [check | compress] src/vid.mp4 C:\whateverFolder ./folder3 ...'
}


console.log('cwd', process.cwd())

async function exec(cmd) {
    return new Promise((res, rej) => {
        cp.exec(cmd, (err, stdout, stderr) => {
            if (err) rej({err, stderr, stdout})
            res(stdout)
        })
    })
}

// logs to stdout / err
async function spawn(cmd, args) {
    return new Promise((res, rej) => {
        const s = cp.spawn(cmd, args, { stdio: 'inherit' })
        s.on('exit', c => c == 0 ? res() : rej(c))
        s.on('error', c => rej(c))
    })
}

const mode = process.argv[2]

if (mode !== 'check' && mode !== 'compress') throw 'Allowed modes: check & compress'

function toReadableDuration(ms) {
    let s = ms / 1000
    let res = ''

    if (s > 60 * 60) {
        const h = Math.floor(s / (60 * 60))
        res += `${h}h `
        s -= h * (60 * 60)
    }
    
    if (s > 60) {
        const m = Math.floor(s / 60)
        res += `${m}m `
        s -= m * 60
    }
    
    res += `${Math.floor(s)}s`
    return res
}
const MB = 1024 * 1024
function toReadableSize(bytes) {
    if (bytes > 1024 * MB) return `${(bytes / (MB * 1024)).toFixed(1)} GB`
    if (bytes > MB) return `${(bytes / MB).toFixed(1)} MB`
    return `${(bytes / 1024).toFixed(1)} KB`
}


function toPercentSaved(origV, newV) {
    const delta = (newV - origV) / origV
    return `${(-delta * 100).toFixed(1)}%`
}

const TMP_FILE_NAME = '_compress_tmp'

async function compressFile(p) {
    const startTime = Date.now()
    const rPath = path.normalize(p)

    const tempPath = path.join(path.dirname(rPath), TMP_FILE_NAME + path.extname(rPath))

    
    const origStats = await exec(`ffprobe.exe "${rPath}" -print_format json -show_format -show_streams`).then(s => JSON.parse(s))
    const origVidStream = origStats.streams.find(s => s.codec_type === 'video')
    console.log(`
    File: ${rPath}
    Start-Time: ${new Date()}
    Duration: ${toReadableDuration(origStats.format.duration * 1000)}
    Orig. size: ${toReadableSize(origStats.format.size)}
    Orig. bitrate: ${origStats.format.bit_rate}
    Orig. codec: ${origVidStream.codec_name}
    `)

    if (origVidStream.codec_name.includes('265') || origVidStream.codec_name == 'hevc') {
        console.log('skipping h265 video')
        return
    }

    await spawn('ffmpeg.exe', [
        '-hide_banner',
        '-v', 'error',
        '-stats',
        '-i', rPath,
        '-c:v', 'libx265',
        '-c:a', 'copy',
        '-x265-params', 'crf=24',
        tempPath
    ])
    
    console.log(`Moving result to ${rPath}`);
    await fs.rename(tempPath, rPath)
    const newStats = await exec(`ffprobe.exe "${rPath}" -print_format json -show_format -show_streams`).then(s => JSON.parse(s))
    const newVidStream = newStats.streams.find(s => s.codec_type === 'video')

    console.log(`
    File: ${rPath}
    new size: ${toReadableSize(newStats.format.size)} (saved ${toPercentSaved(origStats.format.size, newStats.format.size)})
    new bitrate: ${origStats.format.bit_rate}
    new codec: ${newVidStream.codec_name}

    time: ${toReadableDuration(Date.now() - startTime)}
    `)


    return {
        clipDurationS: origStats.format.duration,
        originalSizeB: origStats.format.size,
        compressedSizeB: newStats.format.size,
        compressingTimeS: (Date.now() - startTime) / 1000
    }
}



async function processSrc(src) {

    
    /**
     * Filter out tmp.MOV / tmp.MP4 usw
     * @type {string[]}
     */
    const files = (await globby(src, { absolute: true })).filter(fp => !path.basename(fp).startsWith(TMP_FILE_NAME))
    if (mode === 'check') {
        console.log(`
        ======
        ${files.join('\n')}
        ==> ${files.length} for ${src}        
        `)
    } else if (mode === 'compress') {
        
        const srcStatsAccumulated = {
            clipDurationS: 0,
            originalSizeB: 0,
            compressedSizeB: 0,
            compressingTimeS: 0
        }
        for (const file of files) {
            try {
                await fs.access(file)
                const fileStats = await compressFile(file)
                if (!fileStats) continue;
                Object.entries(fileStats).map(([key, val]) => srcStatsAccumulated[key] += val)
            } catch (error) {
                console.error(`Failed to process file ${file}`, error)
            }
        }

        console.log(`
=== processed src "${src}" ===
total clip duration: ${toReadableDuration(srcStatsAccumulated.clipDurationS * 1000)}
total size: ${toReadableSize(srcStatsAccumulated.originalSizeB)} -> ${toReadableSize(srcStatsAccumulated.compressedSizeB)}
saved ${toPercentSaved(srcStatsAccumulated.originalSizeB, srcStatsAccumulated.compressedSizeB)}
        `)

        return srcStatsAccumulated
    }
}

async function run() {
    console.log('Starting in mode ' + mode)

    //console.log(await exec("ffprobe.exe '.\\Video Prod\\OrganoVino2021\\Footage\\21_07_06_APG\\Steadycam\\DSC_6745.MOV' -print_format json -show_format -show_streams").catch(e => console.error(e)));
    //process.exit(-1)

    const starTime = Date.now()
    for (const src of process.argv.slice(3)) {
        
        try {
            await processSrc(src.replace(/\\/g, '/'))
        } catch (error) {
            console.error(`Failed to process ${src}: `, error)
        }
    }
    console.log(`Finished in ${toReadableDuration(Date.now() - starTime)}`)
}



run()