# LimitRate Publishing Setup Guide

Complete guide to set up npm publishing for LimitRate v1.0.

---

## Part 1: GitHub Organization (Recommended)

### Option A: Create New Organization (Recommended)

1. **Create Organization**
   - Go to: https://github.com/organizations/plan
   - Click "Create a free organization"
   - Name: `limitrate` (or `limitrate-dev` if taken)
   - Email: Your email
   - Select: "My personal account"
   - Make it public (free for open source)

2. **Transfer Repository**
   - Go to current repo: Settings → General
   - Scroll to "Danger Zone"
   - Click "Transfer ownership"
   - New owner: `limitrate` (your new org)
   - Type repo name to confirm
   - Click "I understand, transfer this repository"

3. **Update Repository URLs**
   ```bash
   # Update git remote (if transferred)
   git remote set-url origin git@github.com:limitrate/limitrate.git

   # Verify
   git remote -v
   ```

### Option B: Keep in Personal Account (Alternative)

If you prefer to keep it under your personal account, that's fine too. Just skip the transfer step.

---

## Part 2: npm Account Setup

### Step 1: Create npm Account

1. Go to: https://www.npmjs.com/signup
2. Fill in:
   - **Username**: `limitrate` or your preferred name (publicly visible)
   - **Email**: Your main email
   - **Password**: Strong password (use password manager)
3. Verify email (check inbox)

### Step 2: Install/Update npm CLI

```bash
# Check current version
npm --version

# Update to latest (if needed)
npm install -g npm@latest

# Verify
npm --version  # Should be 10.x or higher
```

### Step 3: Login to npm

```bash
# Login
npm login

# Enter when prompted:
# - Username: (your npm username)
# - Password: (your npm password)
# - Email: (your email)
# - One-time password: (if 2FA already enabled)
```

### Step 4: Enable Two-Factor Authentication (REQUIRED)

**Why required?** npm requires 2FA for publishing scoped packages (@limitrate/*).

```bash
# Enable 2FA for both login and publishing
npm profile enable-2fa auth-and-writes
```

This will:
1. Show a QR code
2. Scan it with an authenticator app:
   - **Google Authenticator** (iOS/Android)
   - **Authy** (iOS/Android/Desktop)
   - **1Password** (if you use it)
   - **Microsoft Authenticator** (iOS/Android)
3. Enter the 6-digit code from your app
4. Save backup codes (IMPORTANT - store safely!)

**Test it:**
```bash
# This should ask for 2FA code
npm profile get
```

### Step 5: Create npm Organization (@limitrate scope)

**Option A: Via Web**
1. Go to: https://www.npmjs.com/org/create
2. Organization name: `limitrate`
3. Select: "Unlimited public packages (free)"
4. Add billing info (won't be charged for public packages)
5. Click "Create"

**Option B: Via CLI**
```bash
# Create organization
npm org create limitrate

# When prompted, choose "unlimited public" (free)
```

**Verify it exists:**
```bash
npm org ls limitrate
# Should show: limitrate (you)
```

### Step 6: Generate Automation Token

For GitHub Actions to publish packages automatically:

```bash
# Generate a granular access token
npm token create

# When prompted:
# - Token type: Choose "Publish" (allows publishing packages)
# - Organizations: Select "limitrate" (or leave default for all)
# - Expiration: Choose "No expiration" or "Custom" (1 year recommended)
```

**Output example:**
```
npm_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

**IMPORTANT**: Copy this token immediately! You can't see it again.

**Store it safely:**
- Password manager
- Secure note
- Don't commit it to git!

---

## Part 3: GitHub Secrets Configuration

### Add NPM_TOKEN to GitHub

1. Go to your GitHub repository
   - If transferred: `https://github.com/limitrate/limitrate`
   - If personal: `https://github.com/YOUR_USERNAME/limitrate`

2. Click: **Settings** → **Secrets and variables** → **Actions**

3. Click: **New repository secret**

4. Add secret:
   - Name: `NPM_TOKEN`
   - Secret: (paste your npm token from Step 6)
   - Click: "Add secret"

5. Verify: You should see `NPM_TOKEN` in the list (value hidden)

---

## Part 4: Update Repository URLs (if transferred)

### In All package.json Files

If you transferred to an organization, update these files:

1. `/package.json` (root)
2. `/packages/core/package.json`
3. `/packages/express/package.json`
4. `/packages/cli/package.json`

**Change:**
```json
{
  "repository": {
    "type": "git",
    "url": "https://github.com/YOUR_OLD_USERNAME/limitrate"
  }
}
```

**To:**
```json
{
  "repository": {
    "type": "git",
    "url": "https://github.com/limitrate/limitrate"
  }
}
```

**Update bugs and homepage too:**
```json
{
  "bugs": {
    "url": "https://github.com/limitrate/limitrate/issues"
  },
  "homepage": "https://github.com/limitrate/limitrate#readme"
}
```

**Quick find and replace:**
```bash
# If you transferred to 'limitrate' org
find . -name "package.json" -type f -exec sed -i '' 's|github.com/YOUR_OLD_USERNAME/limitrate|github.com/limitrate/limitrate|g' {} +

# Verify changes
git diff
```

---

## Part 5: Verify Everything Works

### Test 1: Check npm Login
```bash
npm whoami
# Should show your npm username
```

### Test 2: Check Organization Access
```bash
npm org ls limitrate
# Should show you as a member
```

### Test 3: Test 2FA
```bash
npm profile get
# Should prompt for 2FA code
```

### Test 4: Check GitHub Secret
- Go to: Settings → Secrets and variables → Actions
- Verify `NPM_TOKEN` appears in list

### Test 5: Build Locally
```bash
pnpm clean && pnpm build
# Should succeed with no errors
```

---

## Part 6: Create Changeset (Finally!)

Now you're ready to create the changeset:

```bash
# Create changeset
pnpm changeset
```

**Interactive prompts:**

1. **"Which packages would you like to include?"**
   - Press `space` to select: `@limitrate/core`
   - Press `space` to select: `@limitrate/express`
   - Press `space` to select: `@limitrate/cli`
   - Press `enter` to confirm

2. **"Which packages should have a major bump?"**
   - Press `space` to select all three
   - Press `enter` to confirm
   - (This will bump from 0.1.0 → 1.0.0)

3. **"Please enter a summary for this change"**
   - Type:
   ```
   Initial v1.0 release

   Features:
   - Plan-aware rate limiting with free/pro/enterprise tiers
   - AI cost tracking with hourly and daily caps
   - Three storage backends: Memory, Redis, and Upstash
   - Express middleware with beautiful 429 responses
   - CLI dashboard for real-time monitoring
   - IP allowlist/blocklist support
   - Webhook events for observability
   - Multi-model AI cost estimation
   ```
   - Press `enter` to confirm

**Result:** Creates a file `.changeset/some-random-name.md`

---

## Part 7: Commit and Push

```bash
# Stage all changes
git add .

# Commit
git commit -m "chore: add changeset for v1.0 release"

# Push to main
git push origin main
```

---

## Part 8: GitHub Actions Workflow

After pushing, GitHub Actions will:

1. **Detect the changeset**
2. **Create a PR** titled "Version Packages"
3. This PR will:
   - Update all package.json versions (0.1.0 → 1.0.0)
   - Generate CHANGELOG.md files
   - Update dependencies between packages

4. **Review the PR:**
   - Check version numbers are correct
   - Review generated CHANGELOGs
   - Verify no unexpected changes

5. **Merge the PR** when ready

6. **Automatic publish:** Once merged, GitHub Actions will:
   - Build all packages
   - Run tests
   - Publish to npm automatically

---

## Part 9: Post-Publish Verification

After the workflow completes (5-10 minutes):

### Verify on npm

1. **Check packages exist:**
   - https://www.npmjs.com/package/@limitrate/core
   - https://www.npmjs.com/package/@limitrate/express
   - https://www.npmjs.com/package/@limitrate/cli

2. **Test installation:**
```bash
# Create temp directory
mkdir /tmp/limitrate-test
cd /tmp/limitrate-test

# Test install from npm
npm init -y
npm install @limitrate/express

# Test import
node -e "console.log(require('@limitrate/express'))"
# Should show module exports

# Cleanup
cd ~ && rm -rf /tmp/limitrate-test
```

### Create GitHub Release

1. Go to: https://github.com/limitrate/limitrate/releases
2. Click "Create a new release"
3. Tag: `v1.0.0`
4. Title: `v1.0.0 - Initial Release`
5. Description: Copy from CHANGELOG.md
6. Click "Publish release"

---

## Troubleshooting

### Issue: "You do not have permission to publish @limitrate/core"

**Solution:**
```bash
# Make sure you're logged in
npm whoami

# Check org membership
npm org ls limitrate

# If not a member, join the org via npm website
# Or make sure packages specify correct "publishConfig"
```

Add to each package.json:
```json
{
  "publishConfig": {
    "access": "public"
  }
}
```

### Issue: "Two-factor authentication required"

**Solution:**
- Make sure you set up 2FA in Step 4
- When publishing, enter the 6-digit code from your authenticator app
- For GitHub Actions, the NPM_TOKEN handles this automatically

### Issue: GitHub Action fails with "401 Unauthorized"

**Solution:**
- Regenerate npm token (Step 6)
- Update GitHub secret NPM_TOKEN
- Make sure token has publish permissions

### Issue: "Package name already taken"

**Solution:**
- Check if someone else owns `@limitrate` scope
- If so, choose a different scope (e.g., `@limitrate-io`, `@limitrate-dev`)
- Update all package names in package.json files

---

## Summary Checklist

- [ ] GitHub organization created (or decided to use personal)
- [ ] npm account created
- [ ] npm CLI logged in
- [ ] 2FA enabled on npm
- [ ] npm organization `@limitrate` created
- [ ] npm automation token generated
- [ ] GitHub secret `NPM_TOKEN` added
- [ ] Repository URLs updated (if transferred)
- [ ] Changeset created
- [ ] Changes committed and pushed
- [ ] GitHub Actions PR created
- [ ] PR reviewed and merged
- [ ] Packages published successfully
- [ ] Verified on npmjs.com
- [ ] GitHub release created

---

## Quick Reference Commands

```bash
# Check npm login
npm whoami

# Check org access
npm org ls limitrate

# Create changeset
pnpm changeset

# Build packages
pnpm build

# Run tests
pnpm test

# Check what will be published
pnpm pack --dry-run

# Manually publish (if needed)
pnpm release
```

---

## Support

If you run into issues:
1. Check GitHub Actions logs for detailed errors
2. Check npm documentation: https://docs.npmjs.com/
3. Check Changesets docs: https://github.com/changesets/changesets
4. Open an issue for help

Good luck with your v1.0 launch! 🚀
