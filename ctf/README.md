# CASE 031 · Incident at galway-bastion

At 02:43 on 12 October, the backup service account on `galway-bastion` logged in from somewhere it never had before. By morning its token was being used from outside the network.

Four pieces of evidence are scattered across this profile. Each one hides a flag. All of them teach the same lesson: **redaction, deletion and encoding are not security controls.**

| # | challenge | points | evidence |
|--:|:--|--:|:--|
| 01 | declassify | 100 | the profile banner |
| 02 | brute force | 150 | [`evidence/auth.log`](evidence/auth.log) |
| 03 | git never forgets | 200 | this repository |
| 04 | signed, not sealed | 250 | the token below |

Flags look like `flag{...}`.

## 01 · declassify

The Agent Breaker case file on the banner has one redaction bar that never lifts. A bar drawn over text is a visual effect, not a control.

<details><summary>Hint</summary>

Images are files. Open [`assets/hero.svg`](../assets/hero.svg) as text.

</details>

## 02 · brute force

[`evidence/auth.log`](evidence/auth.log) is an extract from the bastion's sshd log. Someone guessed their way in (MITRE ATT&CK T1110.001).

The flag is `flag{<source-ip>-<username>}` for the login that worked.

<details><summary>Hint</summary>

Count failures per source IP, then find the first `Accepted` that follows a wall of them. Not every noisy IP got in.

</details>

## 03 · git never forgets

The breached account's token was committed to this repository, then "removed". Deleting a file doesn't delete its history, which is why leaked secrets get rotated, not just deleted.

<details><summary>Hint</summary>

```sh
git clone https://github.com/MuhammadMurtuzaHussain/MuhammadMurtuzaHussain
git log --all --full-history -p -- ctf/evidence
```

</details>

## 04 · signed, not sealed

The attacker's session token was recovered from the proxy:

```text
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJnYWx3YXktYmFzdGlvbiIsInN1YiI6InN2Y19iYWNrdXAiLCJyb2xlIjoiYmFja3VwLW9wZXJhdG9yIiwiaWF0IjoxNzkxODYxMTM2LCJleGZpbCI6ImZsYWd7c2lnbmVkX25vdF9zZWFsZWRfODBhN2RhfSJ9.2yjELLxs3s9C2EbRUQN0kz_jKyzjWJxzYjMohGxgdZc
```

A signature proves who issued a token. It hides nothing.

<details><summary>Hint</summary>

A JWT is three base64url parts joined by dots. Decode the middle one.

</details>

## Submit a flag

Issues on this repo are public, so flags are never posted in plaintext. Hash the flag with your GitHub username and submit the hash:

```sh
# macOS
printf '%s' 'flag{...}:your-github-username' | shasum -a 256
# Linux
printf '%s' 'flag{...}:your-github-username' | sha256sum
```

```powershell
# Windows PowerShell
$b = [Text.Encoding]::UTF8.GetBytes('flag{...}:your-github-username')
-join ([Security.Cryptography.SHA256]::Create().ComputeHash($b) | ForEach-Object { $_.ToString('x2') })
```

Then [open a submission](https://github.com/MuhammadMurtuzaHussain/MuhammadMurtuzaHussain/issues/new?template=ctf.yml) and paste the 64-character hash. You can paste several hashes at once. A bot checks it within a minute or two, replies on the issue and updates the board. A plaintext flag scores nothing.

## Scoreboard

<!-- SCOREBOARD:START -->
_No captures yet. First blood is open._
<!-- SCOREBOARD:END -->

## Rules

- Everything you need is public in this profile. Please don't attack GitHub, my website or anything else.
- Hashes are tied to your username, so sharing one won't help anyone else.
- Found a bug in the CTF itself? Open a normal issue and you'll get credit here.
