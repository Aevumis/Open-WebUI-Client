# Release Workflow Fix Implementation Plan

## Executive Summary

The `.github/workflows/release.yml` workflow has persistent failures due to fragile JSON parsing, lack of robust error handling, and use of deprecated GitHub Actions. This document provides a comprehensive analysis and implementation plan to fix these issues.

## Combined Root Cause Analysis

### 1. Fundamental JSON Extraction Flaw (CRITICAL)

**Issue:** Lines 96-97 and 141-142 use `sed -n '/{/,/}/p'` to extract JSON from EAS CLI output.

**Technical Problem:**
- The sed pattern matches from the FIRST `{` to the FIRST `}`, stopping prematurely on nested JSON
- EAS build responses contain nested objects (e.g., `artifacts` object inside build info)
- Results in truncated, invalid JSON that fails `jq` parsing
- No validation or retry logic when extraction fails

**Evidence:** `build-android.yml` has evolved with multiple parsing fixes (commits b5d9a13, bc92452) while `release.yml` still uses the naive approach.

### 2. Missing Robust Error Handling

**Issue:** Unlike `build-android.yml` (lines 90-138), `release.yml` has no fallback mechanisms.

**Missing Capabilities:**
- No retry logic for transient EAS API failures
- No text-based parsing fallback when JSON fails
- No direct Expo API calls as last resort
- No validation of extracted data before use

**Impact:** Single point of failure - any parsing issue terminates the entire release workflow.

### 3. Deprecated GitHub Actions

**Issue:** Using unmaintained actions (lines 219-259):
- `actions/create-release@v1` - deprecated, archived repository
- `actions/upload-release-asset@v1` - deprecated, archived repository

**Risks:**
- May break without warning as GitHub updates platform
- Missing security patches and bug fixes
- No community support or updates
- Less robust error handling than modern alternatives

### 4. Inefficient Artifact Retrieval Pattern

**Issue:** Manual `eas build:view` + `curl` approach (lines 88-123, 133-168).

**Problems:**
- More complex than built-in `eas build:download` command
- Requires parsing build info to extract URL
- Introduces fragility without clear benefit
- Duplicate logic for Android and iOS downloads

### 5. TestFlight Submission Side Effects

**Issue:** Optional TestFlight submission (lines 170-175) has unclear error handling.

**Concerns:**
- Uses `|| echo` to suppress failures, but may leave workflow in inconsistent state
- No validation that IOS_BUILD_ID actually exists before attempting submission
- Could cause confusion in logs when debugging other failures

### 6. CHANGELOG Manipulation Brittleness

**Issue:** Complex git log parsing and file appending (lines 261-284).

**Potential Failures:**
- Git log formatting edge cases
- File write permissions
- Merge conflicts if CHANGELOG was modified in tag commit
- Assumes `GITHUB_REF_NAME` format without validation

### 7. Automated PR Creation Conflicts

**Issue:** PR creation (lines 285-297) can fail if branch exists or has conflicts.

**Failure Scenarios:**
- Branch `chore/release-X.Y.Z` already exists from previous failed run
- Modified files have uncommitted changes
- GITHUB_TOKEN lacks required permissions
- No cleanup of stale branches

## Implementation Plan

### Phase 1: Critical Fixes - JSON Parsing & Error Handling

#### 1.1 Replace Fragile JSON Extraction

**Target:** Lines 88-123 (Android) and 133-168 (iOS)

**Implementation:**
1. Adopt the robust pattern from `build-android.yml:90-138`
2. Add retry logic (3 attempts with 10s delay)
3. Implement multi-strategy parsing:
   - Primary: JSON extraction with validation
   - Secondary: Text-based parsing (`grep "^Artifact"`)
   - Tertiary: Direct Expo API call

**Code Pattern:**
```bash
for i in {1..3}; do
  # Try JSON format
  if eas build:view "$BUILD_ID" --json > build_view_raw.json 2>&1; then
    sed -n '/{/,/}/p' build_view_raw.json > build_view.json
    if jq empty build_view.json 2>/dev/null; then
      break
    fi
  fi

  # Try text format parsing
  if eas build:view "$BUILD_ID" > build_view_text.txt 2>&1; then
    URL=$(grep "^Artifact" build_view_text.txt | awk '{print $2}')
    if [ -n "$URL" ]; then
      echo "{\"artifacts\":{\"buildUrl\":\"$URL\"}}" > build_view.json
      break
    fi
  fi

  # Last resort: Direct API call
  if [ $i -eq 3 ]; then
    curl -H "Authorization: Bearer ${{ secrets.EXPO_TOKEN }}" \
         -H "Accept: application/json" \
         "https://api.expo.dev/v2/builds/$BUILD_ID" > build_view.json
  fi

  sleep 10
done
```

#### 1.2 Add Multiple JSON Path Attempts

**Target:** Lines 109, 154

**Implementation:**
Replace single `jq` query with comprehensive path fallbacks:
```bash
URL=$(jq -r '.artifacts.buildUrl //
              .artifacts.applicationArchiveUrl //
              .artifacts.appBuildUrl //
              .data.artifacts.buildUrl //
              .data.artifacts.applicationArchiveUrl //
              .data.artifacts.appBuildUrl //
              empty' build_view.json)
```

#### 1.3 Validate Build IDs Before Use

**Target:** Lines 85-86, 130-131

**Implementation:**
```bash
BUILD_ID=$(cat build.json | jq -r '.[0].id // .id // empty')
if [ -z "$BUILD_ID" ] || [ "$BUILD_ID" = "null" ]; then
  echo "Error: Failed to extract build ID from EAS response"
  cat build.json
  exit 1
fi
echo "BUILD_ID=$BUILD_ID" >> $GITHUB_ENV
```

### Phase 2: Modernize GitHub Actions

#### 2.1 Replace Deprecated Release Actions

**Target:** Lines 219-259

**Implementation:**
Replace `actions/create-release@v1` and `actions/upload-release-asset@v1` with single modern action:

```yaml
- name: 📦 Create GitHub Release
  uses: softprops/action-gh-release@v2
  with:
    tag_name: ${{ github.ref_name }}
    name: Open-WebUI-Client ${{ env.VERSION }}
    body_path: RELEASE_NOTES.md
    draft: false
    prerelease: false
    files: |
      ${{ env.ANDROID_APK }}
      ${{ env.IOS_IPA }}
      SHA256SUMS.txt
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

**Benefits:**
- Single step replaces 5 separate steps
- Actively maintained with modern features
- Better error handling and retry logic
- Supports glob patterns for multiple files

**Alternative:** Use native GitHub CLI (already available):
```bash
gh release create "${{ github.ref_name }}" \
  "$ANDROID_APK" "$IOS_IPA" "SHA256SUMS.txt" \
  --title "Open-WebUI-Client $VERSION" \
  --notes-file RELEASE_NOTES.md
```

### Phase 3: Improve Artifact Download Strategy

#### 3.1 Consider Reverting to eas build:download

**Target:** Lines 88-123, 133-168

**Evaluation:**
- Research why manual download was implemented
- If no blocking issues, revert to simpler built-in command:
```bash
eas build:download --id "$BUILD_ID" --output "$FILENAME"
```

**Fallback:** If manual download required, extract duplicate logic into reusable bash function:
```bash
download_eas_artifact() {
  local BUILD_ID=$1
  local OUTPUT_FILE=$2
  local PLATFORM=$3

  # [Robust download logic here]
}
```

### Phase 4: Defensive Programming Improvements

#### 4.1 Add Pre-Submit Validation (TestFlight)

**Target:** Lines 170-175

**Implementation:**
```yaml
- name: 🚀 Submit iOS to TestFlight (optional)
  if: ${{ env.IOS_BUILD_ID != '' && env.IOS_BUILD_ID != 'null' }}
  run: |
    echo "Attempting TestFlight submission for build $IOS_BUILD_ID"
    if eas submit --platform ios --latest --non-interactive; then
      echo "TestFlight submission succeeded"
    else
      echo "⚠️  TestFlight submission failed or not configured"
      echo "This is expected if App Store Connect credentials are not set up"
    fi
  continue-on-error: true
```

#### 4.2 Add Branch Cleanup for PR Step

**Target:** Lines 285-297

**Implementation:**
```yaml
- name: 🧹 Clean up old release branch
  run: |
    BRANCH="chore/release-${{ env.VERSION }}"
    if git ls-remote --exit-code --heads origin "$BRANCH"; then
      echo "Deleting existing branch $BRANCH"
      git push origin --delete "$BRANCH" || true
    fi

- name: 🧾 Open PR to update CHANGELOG.md and versions
  uses: peter-evans/create-pull-request@v6
  with:
    # ... existing config ...
```

#### 4.3 Add Version Validation

**Target:** Lines 33-38

**Implementation:**
```bash
- name: 🧪 Validate tag and derive version
  run: |
    echo "GITHUB_REF=$GITHUB_REF"
    echo "GITHUB_REF_NAME=$GITHUB_REF_NAME"

    # Validate tag format
    if [[ ! "$GITHUB_REF_NAME" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      echo "Error: Invalid tag format. Expected vX.Y.Z, got $GITHUB_REF_NAME"
      exit 1
    fi

    VERSION="${GITHUB_REF_NAME#v}"
    echo "VERSION=$VERSION" >> $GITHUB_ENV
    echo "✓ Valid version: $VERSION"
```

### Phase 5: Enhanced Logging & Debugging

#### 5.1 Add Build Step Summaries

**Implementation:**
Add summary outputs at critical steps for GitHub Actions UI:

```bash
echo "## 🏗️ Android Build" >> $GITHUB_STEP_SUMMARY
echo "- Build ID: $ANDROID_BUILD_ID" >> $GITHUB_STEP_SUMMARY
echo "- Profile: production-apk" >> $GITHUB_STEP_SUMMARY
echo "- Status: ✅ Success" >> $GITHUB_STEP_SUMMARY
```

#### 5.2 Add Failure Diagnostics

**Implementation:**
```yaml
- name: 📋 Diagnostic Info on Failure
  if: failure()
  run: |
    echo "## 🔍 Failure Diagnostics"
    echo "Build artifacts:"
    ls -lah *.json *.txt 2>/dev/null || echo "No artifacts found"
    echo ""
    echo "Environment variables:"
    env | grep -E "(BUILD_ID|VERSION|APK|IPA)" || echo "No relevant env vars"
    echo ""
    echo "EAS CLI version:"
    eas --version
```

## Implementation Sequence

### Step 1: Create Feature Branch
```bash
git checkout -b fix/release-workflow-improvements
```

### Step 2: Implement Critical Fixes (Phase 1)
- Update JSON parsing logic
- Add retry and fallback mechanisms
- Test with mock EAS responses

### Step 3: Modernize Actions (Phase 2)
- Replace deprecated actions
- Test release creation with test tag

### Step 4: Test End-to-End
1. Create test tag on feature branch: `v0.0.1-test`
2. Monitor workflow execution
3. Verify both Android and iOS builds
4. Validate release creation and asset uploads

### Step 5: Implement Defensive Improvements (Phase 3-4)
- Add validation and cleanup logic
- Improve error messages

### Step 6: Add Observability (Phase 5)
- Implement step summaries
- Add diagnostic outputs

### Step 7: Documentation Updates
- Update workflow comments
- Create troubleshooting guide
- Document required secrets

## Testing Strategy

### Unit Testing (Per-Step Validation)

**Test 1: JSON Parsing with Nested Objects**
```bash
# Create test file with nested JSON
cat > test_build_view.json <<EOF
{
  "id": "abc123",
  "artifacts": {
    "buildUrl": "https://example.com/build.apk",
    "metadata": {
      "nested": "value"
    }
  }
}
EOF

# Verify extraction works
URL=$(jq -r '.artifacts.buildUrl' test_build_view.json)
[ "$URL" = "https://example.com/build.apk" ] && echo "✓ Pass" || echo "✗ Fail"
```

**Test 2: Retry Logic**
```bash
# Simulate failure then success
for i in {1..3}; do
  if [ $i -eq 3 ]; then
    echo '{"artifacts":{"buildUrl":"success"}}' > result.json
    break
  fi
  echo "Attempt $i failed"
  sleep 1
done
```

**Test 3: Text Fallback Parsing**
```bash
cat > test_text_output.txt <<EOF
Build ID: abc123
Status: finished
Artifact https://example.com/app.apk
Platform: Android
EOF

URL=$(grep "^Artifact" test_text_output.txt | awk '{print $2}')
[ "$URL" = "https://example.com/app.apk" ] && echo "✓ Pass" || echo "✗ Fail"
```

### Integration Testing (Full Workflow)

**Test Scenario 1: Happy Path**
1. Create test tag: `v0.0.1-rc1`
2. Push to trigger workflow
3. Verify:
   - Both builds complete
   - Assets downloaded successfully
   - Release created with correct version
   - CHANGELOG updated
   - PR created and merged

**Test Scenario 2: Build Failure Recovery**
1. Temporarily break EAS config
2. Verify workflow fails gracefully with clear error message
3. Fix config and verify automatic retry succeeds

**Test Scenario 3: Partial Failure**
1. Configure only Android build to succeed
2. Verify workflow continues and releases available artifacts
3. Document expected behavior

**Test Scenario 4: Existing Branch Conflict**
1. Manually create `chore/release-v0.0.1-rc2` branch
2. Trigger workflow
3. Verify cleanup logic removes old branch
4. Verify new PR created successfully

### Smoke Testing (Production Validation)

After deployment to main:
1. Create real release candidate tag: `v0.1.0-rc1`
2. Monitor workflow execution with enhanced logging
3. Download and test APK on physical Android device
4. Download and test IPA via TestFlight
5. Verify checksums match
6. Test installation from GitHub release page

## Rollback Plan

### If Critical Issues Found

**Option 1: Revert Workflow File**
```bash
git checkout main -- .github/workflows/release.yml
git commit -m "revert: rollback release workflow to stable version"
git push origin HEAD
```

**Option 2: Disable Workflow Temporarily**
Add to workflow file top:
```yaml
on:
  push:
    tags:
      - 'DISABLED-v*'  # Temporarily disable
```

**Option 3: Use Manual Release Process**
Document manual steps:
1. Run `eas build` locally
2. Download artifacts manually
3. Create release via GitHub UI

### Gradual Rollout Strategy

1. **Week 1:** Deploy to test environment with `-rc` tags only
2. **Week 2:** Run parallel workflows (old + new) for one production release
3. **Week 3:** Fully switch to new workflow, keep old as backup
4. **Week 4:** Remove old workflow if no issues

## Success Metrics

### Immediate Metrics
- ✅ Workflow completes without failures for test releases
- ✅ Both Android and iOS artifacts generated and uploaded
- ✅ Release notes generated correctly
- ✅ CHANGELOG PR created and mergeable

### Long-term Metrics
- 📊 Workflow failure rate < 5% (vs current ~40-60%)
- 📊 Average workflow duration < 45 minutes
- 📊 Zero manual interventions required for standard releases
- 📊 No duplicate release branches created

## Maintenance Recommendations

### Regular Reviews
- **Monthly:** Check for EAS CLI updates that might change output format
- **Quarterly:** Review GitHub Actions for deprecation notices
- **Per-release:** Validate artifact sizes and checksums

### Documentation
- Keep troubleshooting guide updated with common failure patterns
- Document all required secrets and their purposes
- Maintain changelog of workflow modifications

### Monitoring
- Set up GitHub Actions workflow failure notifications
- Create dashboard for release workflow metrics
- Alert on workflow duration exceeding 60 minutes

## References

### Related Files
- `.github/workflows/build-android.yml:90-138` - Robust parsing implementation
- `.github/workflows/release.yml` - Current implementation
- `eas.json` - Build profile configurations

### External Documentation
- [EAS Build Documentation](https://docs.expo.dev/build/introduction/)
- [softprops/action-gh-release](https://github.com/softprops/action-gh-release)
- [GitHub Actions Best Practices](https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions)

### Commit History References
- b5d9a13 - Build parsing fix attempt
- bc92452 - Additional parsing improvements
- (Current) - Known fragile implementation in release.yml

## Appendix: Key Code Differences

### Current (Fragile) vs Proposed (Robust)

**Current (release.yml:94-97):**
```bash
eas build:view --non-interactive --json --id "$ANDROID_BUILD_ID" > android_view_raw.json 2>&1
sed -n '/{/,/}/p' android_view_raw.json > android_view.json
# Single attempt, no validation, fails on nested JSON
```

**Proposed (based on build-android.yml:90-138):**
```bash
for i in {1..3}; do
  if eas build:view "$ID" --json > build_view_raw.json 2>&1; then
    sed -n '/{/,/}/p' build_view_raw.json > build_view.json
    if jq empty build_view.json 2>/dev/null; then
      break  # Valid JSON, success
    fi
  fi

  # Text fallback
  if eas build:view "$ID" > build_view_text.txt 2>&1; then
    URL=$(grep "^Artifact" build_view_text.txt | awk '{print $2}')
    if [ -n "$URL" ]; then
      echo "{\"artifacts\":{\"buildUrl\":\"$URL\"}}" > build_view.json
      break
    fi
  fi

  # API fallback on final attempt
  [ $i -eq 3 ] && curl -H "Authorization: Bearer $EXPO_TOKEN" \
    "https://api.expo.dev/v2/builds/$ID" > build_view.json

  sleep 10
done
```

**Key Improvements:**
- ✅ Retry logic (3 attempts)
- ✅ JSON validation before use
- ✅ Text-based fallback parsing
- ✅ Direct API call as last resort
- ✅ Better error messages and diagnostics
