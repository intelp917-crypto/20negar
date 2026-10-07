import { spawn, spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const REPO_OWNER = 'intelp917-crypto';
const REPO_NAME = '20negar';
const REPO_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}`;
const PROJECT_ROOT = process.cwd();

export interface UpdateStatus {
  repo: string;
  gitAvailable: boolean;
  isRepo: boolean;
  localSha: string | null;
  remoteSha: string | null;
  upToDate: boolean | null;
  tokenConfigured: boolean;
  message: string;
}

export interface UpdateResult {
  changed: boolean;
  filesChanged: number;
  npmInstalled: boolean;
  error?: string;
}

function githubAuthArgs(): string[] {
  const token = process.env.GITHUB_TOKEN || '';
  if (!token) return [];
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
  return ['-c', `http.https://github.com/.extraheader=AUTHORIZATION: basic ${basic}`];
}

function git(args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync('git', [...githubAuthArgs(), ...args], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    timeout: 60 * 1000,
    windowsHide: true,
  });
  return {
    ok: result.status === 0,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
  };
}

function gitAvailable(): boolean {
  const r = spawnSync('git', ['--version'], { encoding: 'utf8', windowsHide: true });
  return r.status === 0;
}

/** تضمین وجود user.name/email برای commit های خودکار */
function ensureGitIdentity(): void {
  const name = git(['config', 'user.name']);
  if (!name.ok || !name.stdout) git(['config', 'user.name', '20Negar Updater']);
  const email = git(['config', 'user.email']);
  if (!email.ok || !email.stdout) git(['config', 'user.email', 'updater@20negar.local']);
}

function isGitRepo(): boolean {
  return fs.existsSync(path.join(PROJECT_ROOT, '.git'));
}

/**
 * اگر پوشه هنوز repo نیست: init می‌کند، ریموت را اضافه کرده و وضعیت فعلی فایل‌ها
 * را به‌صورت یک commit پایه ثبت می‌کند تا هیچ فایل محلی از بین نرود.
 */
function ensureRepo(): { ok: boolean; error?: string } {
  if (!isGitRepo()) {
    console.log('[Update] ریپوزیتوری محلی یافت نشد — در حال راه‌اندازی git...');
    if (!git(['init', '-b', 'main']).ok) {
      if (!git(['init']).ok) return { ok: false, error: 'git init ناموفق بود.' };
    }
    // تضمین اینکه HEAD به شاخه main اشاره می‌کند (حتی قبل از اولین commit)
    git(['symbolic-ref', 'HEAD', 'refs/heads/main']);
    ensureGitIdentity();
    const remotes = git(['remote']);
    if (!remotes.stdout.split('\n').includes('origin')) {
      if (!git(['remote', 'add', 'origin', REPO_URL]).ok) {
        return { ok: false, error: 'افزودن ریموت origin ناموفق بود.' };
      }
    }
    // واکشی وضعیت ریموت و هم‌ترازی HEAD بدون دست زدن به فایل‌های روی دیسک
    const fetch = git(['fetch', 'origin', 'main']);
    if (fetch.ok) {
      const remoteHead = git(['rev-parse', 'FETCH_HEAD']);
      if (remoteHead.ok) {
        git(['update-ref', '-m', 'import from origin', 'refs/heads/main', remoteHead.stdout]);
      }
    }
    git(['add', '-A']);
    const status = git(['status', '--porcelain']);
    if (status.stdout) {
      const commit = git(['commit', '-m', 'chore: import local workspace state']);
      if (!commit.ok) return { ok: false, error: 'ثبت commit پایه ناموفق بود.' };
    }
    return { ok: true };
  }

  // repo موجود: مطمئن شو ریموت تنظیم است
  ensureGitIdentity();
  const remotes = git(['remote']);
  if (!remotes.stdout.split('\n').includes('origin')) {
    if (!git(['remote', 'add', 'origin', REPO_URL]).ok) {
      return { ok: false, error: 'افزودن ریموت origin ناموفق بود.' };
    }
  }
  return { ok: true };
}

/** آیا فایل‌های غیر از data/ تغییر کرده‌اند؟ (data/ مدام در حال نوشتن است و نباید مانع آپدیت شود) */
function hasNonDataChanges(): boolean {
  const status = git(['status', '--porcelain', '--', '.', ':!data']);
  return status.stdout.length > 0;
}

function countChangedFiles(fromSha: string, toSha: string): number {
  const diff = git(['diff', '--name-only', fromSha, toSha, '--', '.', ':!data']);
  if (!diff.ok) return 0;
  return diff.stdout ? diff.stdout.split('\n').filter(Boolean).length : 0;
}

export class UpdateService {
  private static restarter: (() => void) | null = null;
  private static updating = false;

  static setRestarter(fn: () => void): void {
    this.restarter = fn;
  }

  /** ری‌استارت جداشده با همان دستور (npm run dev) در همان کنسول */
  static spawnSelf(): void {
    try {
      spawn('npm', ['run', 'dev'], {
        cwd: PROJECT_ROOT,
        stdio: 'inherit',
        shell: process.platform === 'win32',
        detached: true,
        env: { ...process.env, FREEBUFF_UPDATE_RESTARTED: '1' },
      });
    } catch (err: any) {
      console.error('[Update] ری‌استارت خودکار ممکن نشد؛ لطفاً سرور را دستی اجرا کنید:', err?.message || err);
    }
  }

  static getStatus(): UpdateStatus {
    const base: UpdateStatus = {
      repo: REPO_URL,
      gitAvailable: gitAvailable(),
      isRepo: isGitRepo(),
      localSha: null,
      remoteSha: null,
      upToDate: null,
      tokenConfigured: Boolean(process.env.GITHUB_TOKEN),
      message: '',
    };

    if (!base.gitAvailable) {
      base.message = 'git روی سرور نصب نیست؛ بروزرسانی خودکار غیرممکن است.';
      return base;
    }
    if (!base.isRepo) {
      base.message = 'ریپوزیتوری محلی هنوز راه‌اندازی نشده است؛ در اولین راه‌اندازی سرور ساخته می‌شود.';
      return base;
    }

    const local = git(['rev-parse', 'HEAD']);
    base.localSha = local.ok ? local.stdout : null;

    // واکشی بی‌صدا برای مقایسه دقیق
    git(['fetch', '--quiet', 'origin', 'main']);
    const remote = git(['rev-parse', 'FETCH_HEAD']);
    base.remoteSha = remote.ok ? remote.stdout : null;

    if (base.localSha && base.remoteSha) {
      if (base.localSha === base.remoteSha) {
        base.upToDate = true;
        base.message = 'نسخه محلی با ریپوزیتوری هم‌سان است.';
      } else {
        // آیا محلی جلوتر است یا ریموت؟
        const lr = git(['rev-list', '--left-right', '--count', `${base.localSha}...${base.remoteSha}`]);
        if (lr.ok) {
          const [ahead, behind] = lr.stdout.split(/\s+/).map((n) => parseInt(n, 10) || 0);
          if (behind === 0 && ahead > 0) {
            base.upToDate = true;
            base.message = `نسخه محلی جلوتر از ریپوزیتوری است (${ahead} commit هنوز push نشده).`;
          } else {
            base.upToDate = false;
            base.message = `نسخه جدیدتری در ریپوزیتوری موجود است (${behind} commit عقب‌تر).`;
          }
        } else {
          base.upToDate = false;
          base.message = 'نسخه جدیدتری در ریپوزیتوری موجود است.';
        }
      }
    } else if (!base.remoteSha) {
      base.message = 'دسترسی به ریپوزیتوری ریموت ممکن نشد (شبکه یا توکن).';
    } else {
      base.message = 'وضعیت نامشخص.';
    }
    return base;
  }

  /**
   * دریافت بروزرسانی از ریپوزیتوری:
   * 1) fetch + fast-forward (در صورت واگرایی، rebase با autostash)
   * 2) در صورت تغییر package.json → npm install
   */
  static async applyUpdate(opts: { npmInstall?: boolean } = {}): Promise<UpdateResult> {
    const result: UpdateResult = { changed: false, filesChanged: 0, npmInstalled: false };

    if (this.updating) {
      result.error = 'بروزرسانی دیگری در حال اجراست.';
      return result;
    }
    this.updating = true;
    try {
      if (!gitAvailable()) {
        result.error = 'git روی سرور نصب نیست.';
        return result;
      }

      const ensure = ensureRepo();
      if (!ensure.ok) {
        result.error = ensure.error;
        return result;
      }

      const fetch = git(['fetch', 'origin', 'main']);
      if (!fetch.ok) {
        result.error = `واکشی از ریموت ناموفق بود: ${fetch.stderr || fetch.stdout}`;
        return result;
      }

      const localSha = git(['rev-parse', 'HEAD']);
      const remoteSha = git(['rev-parse', 'FETCH_HEAD']);
      if (!localSha.ok || !remoteSha.ok) {
        result.error = 'تعیین وضعیت commit ها ناموفق بود.';
        return result;
      }

      if (localSha.stdout === remoteSha.stdout) {
        return result; // هم‌سان
      }

      // اگر تغییرات محلیِ غیر data/ وجود دارد، آپدیت را انجام نده تا چیزی از بین نرود
      if (hasNonDataChanges()) {
        result.error = 'تغییرات commit‌نشده محلی وجود دارد؛ ابتده آن‌ها را commit کنید تا بروزرسانی اعمال شود.';
        return result;
      }

      result.filesChanged = countChangedFiles(localSha.stdout, remoteSha.stdout);

      // fast-forward؛ در صورت واگرایی rebase با autostash
      let merge = git(['merge', '--ff-only', 'FETCH_HEAD']);
      if (!merge.ok) {
        merge = git(['-c', 'rebase.autostash=true', 'pull', '--rebase', 'origin', 'main']);
        if (!merge.ok) {
          result.error = `اعمال بروزرسانی ناموفق بود: ${merge.stderr || merge.stdout}`;
          return result;
        }
      }

      // فقط اگر HEAD واقعاً جلو رفته باشد یعنی چیزی تغییر کرده است
      const newHead = git(['rev-parse', 'HEAD']);
      result.changed = newHead.ok && newHead.stdout !== localSha.stdout;
      if (!result.changed) {
        result.filesChanged = 0;
        return result;
      }

      // نصب وابستگی‌ها در صورت تغییر package.json / package-lock.json
      if (opts.npmInstall) {
        const depChanged = git(['diff', '--name-only', localSha.stdout, remoteSha.stdout, '--', 'package.json', 'package-lock.json']);
        if (depChanged.ok && depChanged.stdout) {
          console.log('[Update] وابستگی‌ها تغییر کرده‌اند — در حال npm install...');
          const npm = spawnSync('npm', ['install', '--no-audit', '--no-fund'], {
            cwd: PROJECT_ROOT,
            encoding: 'utf8',
            timeout: 10 * 60 * 1000,
            windowsHide: true,
          });
          if (npm.status !== 0) {
            result.error = `npm install ناموفق بود: ${(npm.stderr || npm.stdout || '').slice(-500)}`;
            return result;
          }
          result.npmInstalled = true;
        }
      }

      return result;
    } finally {
      this.updating = false;
    }
  }

  /** اجباری‌سازی بروزرسانی از پنل مدیرکل — در صورت موفقیت، سرور ری‌استارت می‌شود */
  static async forceUpdate(): Promise<UpdateResult & { restarting: boolean }> {
    const result = await this.applyUpdate({ npmInstall: true });
    const restarting = result.changed && !result.error && Boolean(this.restarter);
    if (restarting) {
      setTimeout(() => this.restarter?.(), 900);
    }
    return { ...result, restarting };
  }
}
