const { PublicClientApplication } = require('@azure/msal-node');
const crypto = require('crypto');
const fs = require('fs').promises;

const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';
const DEFAULT_SCOPES = ['User.Read', 'Calendars.ReadWrite'];
const CHINA_UTC_OFFSET_HOURS = 8;
const APP_SIGNATURE = '由 HHU 课程表桌面应用同步';
const SYNC_MARKER_PREFIX = 'HHU_SYNC_KEY:';
const SYNC_FORMAT_VERSION = 2;

function assertConfig(value, message) {
    if (!value) {
        throw new Error(message);
    }
}

async function readJsonFile(filePath, fallbackValue = {}) {
    if (!filePath) {
        return fallbackValue;
    }

    try {
        const text = await fs.readFile(filePath, 'utf8');
        return JSON.parse(text);
    } catch (error) {
        return fallbackValue;
    }
}

async function writeJsonFile(filePath, value) {
    if (!filePath) {
        return;
    }

    await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
}

async function updateJsonFile(filePath, updater) {
    const currentValue = await readJsonFile(filePath, {});
    const nextValue = await updater(currentValue);
    await writeJsonFile(filePath, nextValue);
    return nextValue;
}

function normalizeTenantId(tenantId) {
    const value = String(tenantId || '').trim();
    return value || 'common';
}

function parseSemesterStart(semesterStart) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(semesterStart || '').trim());
    if (!match) {
        throw new Error('学期开始日期格式无效，请在设置中填写 YYYY-MM-DD');
    }

    return {
        year: Number(match[1]),
        month: Number(match[2]),
        day: Number(match[3])
    };
}

function addDays(dateParts, days) {
    const date = new Date(Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day));
    date.setUTCDate(date.getUTCDate() + days);

    return {
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        day: date.getUTCDate()
    };
}

function parseWeeksExpression(weeksText) {
    const normalized = String(weeksText || '')
        .replace(/\s+/g, '')
        .replace(/^第/, '')
        .replace(/周/g, '')
        .replace(/[（(].*?[）)]/g, '');

    let oddOnly = false;
    let evenOnly = false;
    let rangeText = normalized;

    if (rangeText.includes('单')) {
        oddOnly = true;
        rangeText = rangeText.replace(/单周?/g, '');
    }

    if (rangeText.includes('双')) {
        evenOnly = true;
        rangeText = rangeText.replace(/双周?/g, '');
    }

    const weeks = [];
    for (const part of rangeText.split(/[，,、]/)) {
        if (!part) {
            continue;
        }

        const rangeMatch = /^(\d+)-(\d+)$/.exec(part);
        if (rangeMatch) {
            const start = Number(rangeMatch[1]);
            const end = Number(rangeMatch[2]);
            for (let week = start; week <= end; week += 1) {
                weeks.push(week);
            }
            continue;
        }

        if (/^\d+$/.test(part)) {
            weeks.push(Number(part));
        }
    }

    let result = Array.from(new Set(weeks)).sort((left, right) => left - right);
    if (oddOnly) {
        result = result.filter((week) => week % 2 === 1);
    }
    if (evenOnly) {
        result = result.filter((week) => week % 2 === 0);
    }

    return result;
}

function parseTimeSlot(timeSlotText) {
    const match = /(\d{2}:\d{2}).*?(\d{2}:\d{2})/.exec(String(timeSlotText || ''));
    if (!match) {
        throw new Error(`无法解析课程时间: ${timeSlotText || '空'}`);
    }

    return {
        start: match[1],
        end: match[2]
    };
}

function chinaLocalTimeToUtc(dateParts, timeText) {
    const [hours, minutes] = timeText.split(':').map((value) => Number(value));
    const utcDate = new Date(Date.UTC(
        dateParts.year,
        dateParts.month - 1,
        dateParts.day,
        hours - CHINA_UTC_OFFSET_HOURS,
        minutes
    ));

    return utcDate.toISOString();
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function buildCourseIdentity(course) {
    return JSON.stringify([
        course.name || '',
        course.code || '',
        course.sequenceNumber || '',
        course.weeks || '',
        course.location || '',
        course.class || '',
        course.credit || '',
        course.type || '',
        Number(course.dayIndex),
        Number(course.timeSlotIndex),
        course.timeSlot || ''
    ]);
}

function collectUniqueCourses(allCourseInfo) {
    const uniqueCourses = new Map();

    for (const [week, info] of Object.entries(allCourseInfo || {})) {
        if (week === 'currentWeek' || !info || !Array.isArray(info.courses)) {
            continue;
        }

        for (const course of info.courses) {
            const key = buildCourseIdentity(course);
            if (!uniqueCourses.has(key)) {
                uniqueCourses.set(key, course);
            }
        }
    }

    return Array.from(uniqueCourses.values());
}

function buildEventVisibleLines(course, weekNumber) {
    return [
        `课程：${course.name || ''}`,
        `课程号：${course.code || ''}`,
        `课序号：${course.sequenceNumber || ''}`,
        `授课周次：${course.weeks || ''}`,
        `当前周次：第${weekNumber}周`,
        `教学班：${course.class || ''}`,
        `学分：${course.credit || ''}`,
        `课程类型：${course.type || ''}`,
        `地点：${course.location || ''}`,
        APP_SIGNATURE
    ];
}

function buildCourseSubject(course) {
    return course.name || '未命名课程';
}

function formatDateParts(dateParts) {
    const year = String(dateParts.year);
    const month = String(dateParts.month).padStart(2, '0');
    const day = String(dateParts.day).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function resolveSyncedWeekNumbers(allCourseInfo) {
    const numericWeeks = Object.keys(allCourseInfo || {})
        .map((week) => Number.parseInt(week, 10))
        .filter((week) => Number.isInteger(week) && week > 0)
        .sort((left, right) => left - right);

    if (numericWeeks.length === 0) {
        return Array.from({ length: 25 }, (_, index) => index + 1);
    }

    const maxWeek = numericWeeks[numericWeeks.length - 1];
    return Array.from({ length: maxWeek }, (_, index) => index + 1);
}

function createEventSyncKey(eventData) {
    return crypto
        .createHash('sha256')
        .update(JSON.stringify(eventData))
        .digest('hex')
        .slice(0, 32);
}

function buildEventBodyHtml(course, weekNumber, syncKey) {
    const visibleHtml = buildEventVisibleLines(course, weekNumber)
        .map((line) => `<div>${escapeHtml(line)}</div>`)
        .join('');

    return `${visibleHtml}<div style="display:none">${SYNC_MARKER_PREFIX}${syncKey}</div>`;
}

function buildWeekMarkerBodyHtml(weekNumber, weekStartDate, weekEndDate, syncKey) {
    const visibleLines = [
        `教学周：第${weekNumber}周`,
        `起始日期：${formatDateParts(weekStartDate)}`,
        `结束日期：${formatDateParts(addDays(weekEndDate, -1))}`,
        APP_SIGNATURE
    ];

    const visibleHtml = visibleLines
        .map((line) => `<div>${escapeHtml(line)}</div>`)
        .join('');

    return `${visibleHtml}<div style="display:none">${SYNC_MARKER_PREFIX}${syncKey}</div>`;
}

function buildManagedEvent(course, semesterStart, weekNumber) {
    const weeks = parseWeeksExpression(course.weeks);
    if (!weeks.includes(weekNumber)) {
        return null;
    }

    const dayIndex = Number(course.dayIndex);
    if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex > 6) {
        throw new Error(`课程 ${course.name || ''} 的星期信息无效`);
    }

    const slot = parseTimeSlot(course.timeSlot);
    const courseDate = addDays(semesterStart, (weekNumber - 1) * 7 + dayIndex);
    const startUtc = chinaLocalTimeToUtc(courseDate, slot.start);
    const endUtc = chinaLocalTimeToUtc(courseDate, slot.end);

    const identity = {
        subject: buildCourseSubject(course),
        startUtc,
        endUtc,
        location: course.location || '',
        courseCode: course.code || '',
        sequenceNumber: course.sequenceNumber || '',
        className: course.class || '',
        weekNumber
    };
    const syncKey = createEventSyncKey(identity);

    return {
        syncKey,
        payload: {
            subject: identity.subject,
            start: {
                dateTime: startUtc,
                timeZone: 'UTC'
            },
            end: {
                dateTime: endUtc,
                timeZone: 'UTC'
            },
            location: course.location ? { displayName: course.location } : undefined,
            body: {
                contentType: 'html',
                content: buildEventBodyHtml(course, weekNumber, syncKey)
            },
            categories: ['HHU 课程表'],
            reminderMinutesBeforeStart: 15,
            isReminderOn: true
        }
    };
}

function buildWeekMarkerEvent(semesterStart, weekNumber) {
    const weekStartDate = addDays(semesterStart, (weekNumber - 1) * 7);
    const weekEndDate = addDays(weekStartDate, 7);
    const identity = {
        type: 'week_marker',
        subject: `HHU 第${weekNumber}周`,
        startDate: formatDateParts(weekStartDate),
        endDate: formatDateParts(weekEndDate),
        weekNumber
    };
    const syncKey = createEventSyncKey(identity);

    return {
        syncKey,
        payload: {
            subject: identity.subject,
            isAllDay: true,
            showAs: 'free',
            start: {
                dateTime: `${identity.startDate}T00:00:00`,
                timeZone: 'China Standard Time'
            },
            end: {
                dateTime: `${identity.endDate}T00:00:00`,
                timeZone: 'China Standard Time'
            },
            body: {
                contentType: 'html',
                content: buildWeekMarkerBodyHtml(weekNumber, weekStartDate, weekEndDate, syncKey)
            },
            categories: ['HHU 课程表', 'HHU 周次'],
            isReminderOn: false
        }
    };
}

function buildManagedCourseEvents(allCourseInfo, semesterStart) {
    const semesterStartDate = parseSemesterStart(semesterStart);
    const uniqueCourses = collectUniqueCourses(allCourseInfo);
    const events = [];

    for (const weekNumber of resolveSyncedWeekNumbers(allCourseInfo)) {
        events.push(buildWeekMarkerEvent(semesterStartDate, weekNumber));
    }

    for (const course of uniqueCourses) {
        const weeks = parseWeeksExpression(course.weeks);
        for (const weekNumber of weeks) {
            const event = buildManagedEvent(course, semesterStartDate, weekNumber);
            if (event) {
                events.push(event);
            }
        }
    }

    return events.sort((left, right) => (
        left.payload.start.dateTime.localeCompare(right.payload.start.dateTime) ||
        left.payload.subject.localeCompare(right.payload.subject)
    ));
}

function buildCourseEvents(allCourseInfo, semesterStart) {
    return buildManagedCourseEvents(allCourseInfo, semesterStart).map((event) => event.payload);
}

function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

async function graphRequest(accessToken, method, path, body, options = {}) {
    const { headers = {}, retries = 2 } = options;
    const response = await fetch(`${GRAPH_BASE_URL}${path}`, {
        method,
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            ...headers
        },
        body: body ? JSON.stringify(body) : undefined
    });

    if ((response.status === 429 || response.status === 503) && retries > 0) {
        const retryAfterHeader = response.headers.get('retry-after');
        const retryAfterSeconds = Number.parseInt(retryAfterHeader, 10);
        const delayMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
            ? retryAfterSeconds * 1000
            : 2000;
        await sleep(delayMs);
        return graphRequest(accessToken, method, path, body, {
            headers,
            retries: retries - 1
        });
    }

    if (response.status === 204) {
        return null;
    }

    const text = await response.text();
    let payload = null;
    if (text) {
        try {
            payload = JSON.parse(text);
        } catch (error) {
            payload = { raw: text };
        }
    }

    if (!response.ok) {
        const apiMessage = payload && payload.error && payload.error.message
            ? payload.error.message
            : payload && payload.raw
                ? payload.raw
                : `Graph API 请求失败 (${response.status})`;
        const requestError = new Error(apiMessage);
        requestError.status = response.status;
        requestError.payload = payload;
        throw requestError;
    }

    return payload;
}

function encodeGraphPathSegment(value) {
    return encodeURIComponent(String(value));
}

async function listCalendars(accessToken) {
    const calendars = [];
    let nextPath = '/me/calendars?$top=200&$select=id,name,canEdit,owner';

    while (nextPath) {
        const payload = await graphRequest(accessToken, 'GET', nextPath);
        calendars.push(...(payload.value || []));

        const nextLink = payload['@odata.nextLink'];
        nextPath = nextLink ? nextLink.replace(GRAPH_BASE_URL, '') : null;
    }

    return calendars;
}

async function getCalendarById(accessToken, calendarId) {
    try {
        return await graphRequest(
            accessToken,
            'GET',
            `/me/calendars/${encodeGraphPathSegment(calendarId)}?$select=id,name,canEdit,owner`
        );
    } catch (error) {
        if (error.status === 404) {
            return null;
        }
        throw error;
    }
}

function isWritableCalendar(calendar) {
    return Boolean(calendar && calendar.canEdit);
}

async function listCalendarEvents(accessToken, calendarId) {
    const events = [];
    let nextPath = `/me/calendars/${encodeGraphPathSegment(calendarId)}/events?$top=200&$select=id,subject,body,start,end,location`;

    while (nextPath) {
        const payload = await graphRequest(accessToken, 'GET', nextPath, null, {
            headers: {
                Prefer: 'outlook.body-content-type="html"'
            }
        });
        events.push(...(payload.value || []));

        const nextLink = payload['@odata.nextLink'];
        nextPath = nextLink ? nextLink.replace(GRAPH_BASE_URL, '') : null;
    }

    return events;
}

function extractSyncKey(bodyContent) {
    const match = new RegExp(`${SYNC_MARKER_PREFIX}([a-f0-9]{32})`, 'i').exec(String(bodyContent || ''));
    return match ? match[1].toLowerCase() : '';
}

function isLegacyManagedEvent(bodyContent) {
    return String(bodyContent || '').includes(APP_SIGNATURE);
}

function createCachePlugin(cachePath) {
    return {
        beforeCacheAccess: async (cacheContext) => {
            try {
                const cacheFile = await fs.readFile(cachePath, 'utf8');
                cacheContext.tokenCache.deserialize(cacheFile);
            } catch (error) {
                cacheContext.tokenCache.deserialize('{}');
            }
        },
        afterCacheAccess: async (cacheContext) => {
            if (!cacheContext.cacheHasChanged) {
                return;
            }

            await fs.writeFile(cachePath, cacheContext.tokenCache.serialize(), 'utf8');
        }
    };
}

async function acquireAccessToken({
    clientId,
    tenantId,
    tokenCachePath,
    statePath,
    onProgress,
    allowInteractiveAuth = true
}) {
    const authorityTenant = normalizeTenantId(tenantId);
    const pca = new PublicClientApplication({
        auth: {
            clientId,
            authority: `https://login.microsoftonline.com/${authorityTenant}`
        },
        cache: tokenCachePath ? { cachePlugin: createCachePlugin(tokenCachePath) } : undefined
    });

    const tokenCache = pca.getTokenCache();
    const accounts = await tokenCache.getAllAccounts();
    const syncState = await readJsonFile(statePath, {});

    let selectedAccount = null;
    if (syncState.homeAccountId) {
        selectedAccount = accounts.find((account) => account.homeAccountId === syncState.homeAccountId) || null;
    }
    if (!selectedAccount && syncState.username) {
        selectedAccount = accounts.find((account) => account.username === syncState.username) || null;
    }
    if (!selectedAccount && accounts.length === 1) {
        selectedAccount = accounts[0];
    }

    if (selectedAccount) {
        try {
            const silentResult = await pca.acquireTokenSilent({
                account: selectedAccount,
                scopes: DEFAULT_SCOPES
            });

            if (silentResult && silentResult.accessToken) {
                await updateJsonFile(statePath, (currentState) => ({
                    ...currentState,
                    homeAccountId: selectedAccount.homeAccountId,
                    username: selectedAccount.username
                }));

                return {
                    accessToken: silentResult.accessToken,
                    account: silentResult.account || selectedAccount,
                    usedInteractiveAuth: false
                };
            }
        } catch (error) {
            if (onProgress) {
                onProgress({
                    type: 'info',
                    message: '微软授权缓存已失效，准备重新获取令牌...'
                });
            }
        }
    }

    if (!allowInteractiveAuth) {
        throw new Error('微软登录已过期，请手动点击一次“同步微软日历”重新授权后，定时同步才能继续运行');
    }

    const interactiveResult = await pca.acquireTokenByDeviceCode({
        scopes: DEFAULT_SCOPES,
        deviceCodeCallback: (response) => {
            if (onProgress) {
                onProgress({
                    type: 'device_code',
                    message: response.message,
                    userCode: response.userCode,
                    verificationUri: response.verificationUri,
                    verificationUriComplete: response.verificationUriComplete || ''
                });
            }
        }
    });

    if (!interactiveResult || !interactiveResult.accessToken) {
        throw new Error('未能获取微软访问令牌');
    }

    const account = interactiveResult.account || null;
    if (account) {
        await updateJsonFile(statePath, (currentState) => ({
            ...currentState,
            homeAccountId: account.homeAccountId,
            username: account.username
        }));
    }

    return {
        accessToken: interactiveResult.accessToken,
        account,
        usedInteractiveAuth: true
    };
}

async function findOrCreateManagedCalendar(accessToken, calendarName, statePath, onProgress) {
    const syncState = await readJsonFile(statePath, {});

    if (syncState.calendarId) {
        const savedCalendar = await getCalendarById(accessToken, syncState.calendarId);
        if (savedCalendar && isWritableCalendar(savedCalendar)) {
            if (savedCalendar.name !== calendarName) {
                await graphRequest(
                    accessToken,
                    'PATCH',
                    `/me/calendars/${encodeGraphPathSegment(savedCalendar.id)}`,
                    { name: calendarName }
                );
                savedCalendar.name = calendarName;
            }
            return savedCalendar;
        }

        if (savedCalendar && !isWritableCalendar(savedCalendar) && onProgress) {
            const ownerName = savedCalendar.owner && savedCalendar.owner.name ? savedCalendar.owner.name : '其他账户';
            onProgress({
                type: 'info',
                message: `已跳过只读日历「${savedCalendar.name}」（所有者：${ownerName}），将改用专用可写日历`
            });
        }
    }

    const calendars = await listCalendars(accessToken);
    const sameNameCalendar = calendars.find((calendar) => (
        calendar.name === calendarName && isWritableCalendar(calendar)
    ));
    if (sameNameCalendar) {
        return sameNameCalendar;
    }

    const sameNameReadOnlyCalendar = calendars.find((calendar) => (
        calendar.name === calendarName && !isWritableCalendar(calendar)
    ));
    if (sameNameReadOnlyCalendar && onProgress) {
        const ownerName = sameNameReadOnlyCalendar.owner && sameNameReadOnlyCalendar.owner.name
            ? sameNameReadOnlyCalendar.owner.name
            : '其他账户';
        onProgress({
            type: 'info',
            message: `发现同名只读日历「${calendarName}」（所有者：${ownerName}），不会写入它，将新建一个可写日历`
        });
    }

    if (onProgress) {
        onProgress({
            type: 'info',
            message: `创建日历：${calendarName}`
        });
    }

    return graphRequest(accessToken, 'POST', '/me/calendars', {
        name: calendarName
    });
}

function createExistingEventIndex(events) {
    const managedByKey = new Map();
    const duplicateManagedEventIds = [];
    const legacyManagedEventIds = [];

    for (const event of events) {
        const bodyContent = event && event.body ? event.body.content : '';
        const syncKey = extractSyncKey(bodyContent);

        if (syncKey) {
            if (managedByKey.has(syncKey)) {
                duplicateManagedEventIds.push(event.id);
            } else {
                managedByKey.set(syncKey, event);
            }
            continue;
        }

        if (isLegacyManagedEvent(bodyContent)) {
            legacyManagedEventIds.push(event.id);
        }
    }

    return {
        managedByKey,
        duplicateManagedEventIds,
        legacyManagedEventIds
    };
}

async function deleteCalendarEvent(accessToken, calendarId, eventId) {
    await graphRequest(
        accessToken,
        'DELETE',
        `/me/calendars/${encodeGraphPathSegment(calendarId)}/events/${encodeGraphPathSegment(eventId)}`
    );
}

async function createCalendarEvent(accessToken, calendarId, eventPayload) {
    return graphRequest(
        accessToken,
        'POST',
        `/me/calendars/${encodeGraphPathSegment(calendarId)}/events`,
        eventPayload
    );
}

async function syncCoursesToMicrosoftCalendar({
    clientId,
    tenantId = 'common',
    calendarName = 'HHU 课程表',
    semesterStart,
    allCourseInfo,
    tokenCachePath,
    statePath,
    allowInteractiveAuth = true,
    onProgress
}) {
    assertConfig(clientId, '请先在设置中填写微软应用 Client ID');
    assertConfig(semesterStart, '请先在设置中填写学期开始日期');

    const managedEvents = buildManagedCourseEvents(allCourseInfo, semesterStart);
    if (managedEvents.length === 0) {
        throw new Error('当前没有可同步到微软日历的课程事件');
    }

    if (onProgress) {
        onProgress({
            type: 'info',
            message: `已生成 ${managedEvents.length} 个课程日历事件`
        });
    }

    const authResult = await acquireAccessToken({
        clientId,
        tenantId,
        tokenCachePath,
        statePath,
        onProgress,
        allowInteractiveAuth
    });

    const calendar = await findOrCreateManagedCalendar(
        authResult.accessToken,
        calendarName,
        statePath,
        onProgress
    );
    const existingEvents = await listCalendarEvents(authResult.accessToken, calendar.id);
    const existingIndex = createExistingEventIndex(existingEvents);

    if (existingIndex.legacyManagedEventIds.length > 0 && onProgress) {
        onProgress({
            type: 'info',
            message: `检测到 ${existingIndex.legacyManagedEventIds.length} 个旧版同步事件，正在迁移为增量模式...`
        });
    }

    const desiredEventKeys = new Set(managedEvents.map((event) => event.syncKey));
    const eventsToCreate = managedEvents.filter((event) => !existingIndex.managedByKey.has(event.syncKey));
    const eventsToDelete = [
        ...existingIndex.duplicateManagedEventIds,
        ...existingIndex.legacyManagedEventIds,
        ...Array.from(existingIndex.managedByKey.entries())
            .filter(([syncKey]) => !desiredEventKeys.has(syncKey))
            .map(([, event]) => event.id)
    ];

    for (let index = 0; index < eventsToDelete.length; index += 1) {
        await deleteCalendarEvent(authResult.accessToken, calendar.id, eventsToDelete[index]);

        if (onProgress && (index === eventsToDelete.length - 1 || (index + 1) % 10 === 0)) {
            onProgress({
                type: 'info',
                message: `正在清理旧事件：${index + 1}/${eventsToDelete.length}`
            });
        }
    }

    for (let index = 0; index < eventsToCreate.length; index += 1) {
        await createCalendarEvent(authResult.accessToken, calendar.id, eventsToCreate[index].payload);

        if (onProgress && (index === eventsToCreate.length - 1 || (index + 1) % 10 === 0)) {
            onProgress({
                type: 'info',
                message: `正在写入课程事件：${index + 1}/${eventsToCreate.length}`
            });
        }
    }

    const unchangedCount = managedEvents.length - eventsToCreate.length;
    const summary = {
        calendarId: calendar.id,
        calendarName: calendar.name,
        eventCount: managedEvents.length,
        createdCount: eventsToCreate.length,
        deletedCount: eventsToDelete.length,
        unchangedCount,
        usedInteractiveAuth: authResult.usedInteractiveAuth,
        accountLabel: authResult.account && authResult.account.username
            ? authResult.account.username
            : ''
    };

    await updateJsonFile(statePath, (currentState) => ({
        ...currentState,
        syncFormatVersion: SYNC_FORMAT_VERSION,
        calendarId: calendar.id,
        calendarName: calendar.name,
        homeAccountId: authResult.account && authResult.account.homeAccountId
            ? authResult.account.homeAccountId
            : currentState.homeAccountId || '',
        username: authResult.account && authResult.account.username
            ? authResult.account.username
            : currentState.username || '',
        lastSuccessfulSyncTime: new Date().toISOString(),
        lastSummary: summary
    }));

    return summary;
}

module.exports = {
    buildCourseEvents,
    syncCoursesToMicrosoftCalendar
};
