import * as fs from 'fs';
import * as path from 'path';
import { spawnSync, execSync } from 'child_process';

const EVAL_PATH = path.resolve(__dirname, '../../../pixie-engine-cpp/src/evaluate.cpp');
const BUILD_SCRIPT = path.resolve(__dirname, '../../../pixie-engine-cpp/compile.bat');
const BUILD_DIR = path.resolve(__dirname, '../../../pixie-engine-cpp');
const REPORT_PATH = path.resolve(__dirname, '../../../../limbo_regression.md');
const SWEEP_REPORT_PATH = path.resolve(__dirname, '../../../../sweep_report.md');

const VALUES_TO_TEST = [75, 100, 125, 150, 175];
const MAX_GAMES = '30';

function modifyBonus(bonus: number) {
    let content = fs.readFileSync(EVAL_PATH, 'utf-8');
    // We are looking for: classical_score += popcount(km_on_outposts) * 150 * color_sign;
    const regexScore = /classical_score \+= popcount\(km_on_outposts\) \* \d+ \* color_sign;/g;
    const regexBreakdown = /tl_breakdown->power_potential \+= popcount\(km_on_outposts\) \* \d+ \* color_sign;/g;
    
    content = content.replace(regexScore, `classical_score += popcount(km_on_outposts) * ${bonus} * color_sign;`);
    content = content.replace(regexBreakdown, `tl_breakdown->power_potential += popcount(km_on_outposts) * ${bonus} * color_sign;`);
    
    fs.writeFileSync(EVAL_PATH, content);
    console.log(`Updated evaluate.cpp with bonus ${bonus}`);
}

function compileEngine() {
    console.log('Compiling engine...');
    const result = spawnSync('cmd.exe', ['/c', 'compile.bat'], { cwd: BUILD_DIR, stdio: 'inherit' });
    if (result.status !== 0) {
        throw new Error('Compilation failed');
    }
}

function runRegression() {
    console.log(`Running regression pipeline (MAX_GAMES=${MAX_GAMES})...`);
    const env = { ...process.env, MAX_GAMES };
    const result = spawnSync('npx.cmd', ['ts-node', 'regression_pipeline.ts'], { cwd: __dirname, env, stdio: 'inherit' });
}

function parseReport(bonus: number): string {
    if (!fs.existsSync(REPORT_PATH)) return `| +${bonus} | Failed | - | - | - |`;
    
    const content = fs.readFileSync(REPORT_PATH, 'utf-8');
    
    const winMatch = content.match(/\*\*Wins \(Test\)\*\*: (\d+) \| \*\*Wins \(Base\)\*\*: (\d+) \| \*\*Draws\*\*: (\d+)/);
    const eloMatch = content.match(/\*\*Estimated Elo Change\*\*: ([\+\-\d\.]+) ± ([\d\.]+)/);
    const ttMatch = content.match(/\*\*Total TT Hits\*\* \| \d+ \| (\d+) \|/);
    
    let wdl = '-';
    let elo = '-';
    let ci = '-';
    let tt = '-';
    
    if (winMatch) {
        wdl = `${winMatch[1]}-${winMatch[3]}-${winMatch[2]}`;
    }
    if (eloMatch) {
        elo = eloMatch[1];
        ci = `±${eloMatch[2]}`;
    }
    if (ttMatch) {
        tt = ttMatch[1];
    }
    
    return `| +${bonus} | ${wdl} | ${elo} | ${ci} | ${tt} |`;
}

function runSweep() {
    let md = '# Knightmare Outpost Bonus Parameter Sweep\n\n';
    md += '| Bonus | W-D-L (Test) | Est. Elo | 95% CI | Avg TT Hits (Test) |\n';
    md += '|-------|--------------|----------|--------|--------------------|\n';
    
    for (const bonus of VALUES_TO_TEST) {
        console.log(`\n\n=== RUNNING SWEEP FOR BONUS +${bonus} ===`);
        modifyBonus(bonus);
        compileEngine();
        runRegression();
        
        const row = parseReport(bonus);
        console.log(`Result: ${row}`);
        md += row + '\n';
        
        fs.writeFileSync(SWEEP_REPORT_PATH, md);
    }
    
    console.log(`\nSweep complete. Report saved to ${SWEEP_REPORT_PATH}`);
}

runSweep();
