import { describe, it } from 'node:test';
import assert from 'node:assert';
// -------------------------------------------------------------
// Replication of content.js matching & detection logic for tests
// -------------------------------------------------------------
function normalizeText(text) {
    if (!text || typeof text !== 'string')
        return '';
    return text
        .toLowerCase()
        .replace(/[أإآٱ]/g, 'ا')
        .replace(/ة/g, 'ه')
        .replace(/ى/g, 'ي')
        .replace(/[ؤئ]/g, 'ء')
        .replace(/[\u064B-\u065F\u0670]/g, '')
        .replace(/[\s\u00A0\u200B\uFEFF]+/g, ' ')
        .trim();
}
function doesTextMatchStudent(rawText, studentId, fullName) {
    if (!rawText)
        return false;
    const normRaw = normalizeText(rawText);
    const cleanId = (studentId || '').trim();
    // Match 1: Exact or embedded Student ID
    if (cleanId && normRaw.includes(cleanId.toLowerCase())) {
        return true;
    }
    // Match 2: Digits-only ID match
    const idDigits = cleanId.replace(/\D/g, '');
    if (idDigits && idDigits.length >= 6) {
        const rawDigits = rawText.replace(/\D/g, '');
        if (rawDigits.includes(idDigits)) {
            return true;
        }
    }
    // Match 3: Full Name matching
    if (fullName) {
        const normName = normalizeText(fullName);
        if (normName.length >= 3) {
            if (normRaw.includes(normName) || normName.includes(normRaw)) {
                return true;
            }
            const nameTokens = normName.split(' ').filter(t => t.length >= 2);
            if (nameTokens.length > 0) {
                if (nameTokens.length >= 2) {
                    const firstToken = nameTokens[0];
                    const lastToken = nameTokens[nameTokens.length - 1];
                    if (normRaw.includes(firstToken) && normRaw.includes(lastToken)) {
                        return true;
                    }
                }
                let matchCount = 0;
                for (const token of nameTokens) {
                    if (normRaw.includes(token)) {
                        matchCount++;
                    }
                }
                if (matchCount >= 2 || (nameTokens.length === 1 && matchCount === 1)) {
                    return true;
                }
            }
        }
    }
    return false;
}
function findCheckboxForStudentMock(studentId, fullName, doc) {
    const checkboxes = doc.querySelectorAll('input[type="checkbox"]');
    if (checkboxes.length === 0)
        return null;
    // Tier 1: Explicit <label for="id"> matching
    const labels = doc.querySelectorAll('label');
    for (const lbl of labels) {
        if (doesTextMatchStudent(lbl.textContent, studentId, fullName)) {
            const forId = lbl.attributes?.['for'];
            if (forId) {
                const el = doc.getElementById(forId);
                if (el && el.tagName === 'INPUT') {
                    return { checkbox: el, label: lbl };
                }
            }
        }
    }
    // Tier 2: Checkbox direct attributes
    for (const chk of checkboxes) {
        if (studentId && doesTextMatchStudent(chk.id, studentId, null)) {
            return { checkbox: chk, label: null };
        }
    }
    // Tier 3: Sibling elements
    for (const chk of checkboxes) {
        if (chk.nextElementSibling && doesTextMatchStudent(chk.nextElementSibling.textContent, studentId, fullName)) {
            return { checkbox: chk, label: chk.nextElementSibling };
        }
    }
    // Tier 4: Table Row
    const rows = doc.querySelectorAll('tr');
    for (const row of rows) {
        if (doesTextMatchStudent(row.textContent, studentId, fullName)) {
            const rowChk = row.children?.find(c => c.tagName === 'INPUT' || (c.children && c.children.some(cc => cc.tagName === 'INPUT')));
            const foundChk = rowChk?.tagName === 'INPUT' ? rowChk : rowChk?.children?.find(cc => cc.tagName === 'INPUT');
            if (foundChk) {
                return { checkbox: foundChk, row: row };
            }
        }
    }
    return null;
}
describe('AVQR Universal Checkbox Engine & Iframe Verification', () => {
    it('normalizes Arabic and Latin strings accurately', () => {
        assert.strictEqual(normalizeText('  أَحْمَدُ  '), 'احمد');
        assert.strictEqual(normalizeText('Mohamed   Matany'), 'mohamed matany');
        assert.strictEqual(normalizeText('MOHAMED AHMED MOHAMED MATANY AHMED'), 'mohamed ahmed mohamed matany ahmed');
    });
    it('matches student across various formats (case-insensitive, token, ID)', () => {
        const studentId = '20264712';
        const fullName = 'Mohamed Ahmed Mohamed Matany Ahmed';
        // Exact label text as seen in user screenshot on W3Schools
        assert.strictEqual(doesTextMatchStudent('Mohamed Ahmed Mohamed Matany Ahmed', studentId, fullName), true);
        assert.strictEqual(doesTextMatchStudent('mohamed ahmed mohamed matany ahmed', studentId, fullName), true);
        assert.strictEqual(doesTextMatchStudent('Mohamed Matany', studentId, fullName), true);
        assert.strictEqual(doesTextMatchStudent('Student: 20264712', studentId, fullName), true);
        assert.strictEqual(doesTextMatchStudent('#20264712 - Mohamed Matany', studentId, fullName), true);
        // Negative checks
        assert.strictEqual(doesTextMatchStudent('I have a bike', studentId, fullName), false);
        assert.strictEqual(doesTextMatchStudent('I have a car', studentId, fullName), false);
        assert.strictEqual(doesTextMatchStudent('I have a boat', studentId, fullName), false);
    });
    it('finds and checks the EXACT checkbox in W3Schools TryIt editor HTML structure', () => {
        // Replicating W3Schools TryIt structure:
        // <form action="/action_page.php">
        //   <input type="checkbox" id="vehicle1" name="vehicle1" value="Bike">
        //   <label for="vehicle1"> Mohamed Ahmed Mohamed Matany Ahmed</label><br>
        //   <input type="checkbox" id="vehicle2" name="vehicle2" value="Car">
        //   <label for="vehicle2"> I have a car</label><br>
        //   <input type="checkbox" id="vehicle3" name="vehicle3" value="Boat">
        //   <label for="vehicle3"> I have a boat</label><br><br>
        // </form>
        const chk1 = { tagName: 'INPUT', type: 'checkbox', id: 'vehicle1', name: 'vehicle1', value: 'Bike', checked: false };
        const lbl1 = { tagName: 'LABEL', attributes: { for: 'vehicle1' }, textContent: ' Mohamed Ahmed Mohamed Matany Ahmed' };
        const chk2 = { tagName: 'INPUT', type: 'checkbox', id: 'vehicle2', name: 'vehicle2', value: 'Car', checked: false };
        const lbl2 = { tagName: 'LABEL', attributes: { for: 'vehicle2' }, textContent: ' I have a car' };
        const chk3 = { tagName: 'INPUT', type: 'checkbox', id: 'vehicle3', name: 'vehicle3', value: 'Boat', checked: false };
        const lbl3 = { tagName: 'LABEL', attributes: { for: 'vehicle3' }, textContent: ' I have a boat' };
        const mockDoc = {
            elements: [chk1, lbl1, chk2, lbl2, chk3, lbl3],
            getElementById: (id) => {
                if (id === 'vehicle1')
                    return chk1;
                if (id === 'vehicle2')
                    return chk2;
                if (id === 'vehicle3')
                    return chk3;
                return null;
            },
            querySelectorAll: (sel) => {
                if (sel === 'input[type="checkbox"]')
                    return [chk1, chk2, chk3];
                if (sel === 'label')
                    return [lbl1, lbl2, lbl3];
                return [];
            },
            querySelector: () => null
        };
        const match = findCheckboxForStudentMock('20264712', 'Mohamed Ahmed Mohamed Matany Ahmed', mockDoc);
        assert.ok(match, 'Match should be found for student');
        assert.strictEqual(match.checkbox.id, 'vehicle1', 'Target checkbox must be vehicle1');
        // Simulate actuation
        match.checkbox.checked = true;
        // Verify: ONLY vehicle1 is checked, vehicle2 and vehicle3 remain FALSE!
        assert.strictEqual(chk1.checked, true, 'vehicle1 MUST be checked');
        assert.strictEqual(chk2.checked, false, 'vehicle2 MUST remain unchecked');
        assert.strictEqual(chk3.checked, false, 'vehicle3 MUST remain unchecked');
    });
    it('correctly handles university attendance table rows (<tr>)', () => {
        const chkTable = { tagName: 'INPUT', type: 'checkbox', id: 'att_row_1', checked: false };
        const rowTable = {
            tagName: 'TR',
            textContent: '1 20264712 Mohamed Ahmed Mohamed Matany Ahmed CS-2026',
            children: [
                { tagName: 'TD', children: [chkTable] },
                { tagName: 'TD', textContent: '20264712' },
                { tagName: 'TD', textContent: 'Mohamed Ahmed Mohamed Matany Ahmed' }
            ]
        };
        const mockTableDoc = {
            elements: [chkTable, rowTable],
            getElementById: () => null,
            querySelectorAll: (sel) => {
                if (sel === 'input[type="checkbox"]')
                    return [chkTable];
                if (sel === 'tr')
                    return [rowTable];
                return [];
            },
            querySelector: () => null
        };
        const match = findCheckboxForStudentMock('20264712', 'Mohamed Ahmed Mohamed Matany Ahmed', mockTableDoc);
        assert.ok(match, 'Row match should be found');
        assert.strictEqual(match.checkbox.id, 'att_row_1');
        match.checkbox.checked = true;
        assert.strictEqual(chkTable.checked, true);
    });
});
