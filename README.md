# 🏛️ ATT Vision QR Tool (AVQR / AVQT)
### Developed by **Matany Group** • UI/UX Inspired by **upstore.one** • Collaboration with **Future University in Egypt (FUE)**

![Neubrutalism](https://img.shields.io/badge/Design-Neubrutalism-FFE600?style=for-the-badge&logoColor=121212)
![Database](https://img.shields.io/badge/Database-Neon.tech%20Serverless-00F090?style=for-the-badge)
![Vercel Live](https://img.shields.io/badge/Vercel-LIVE%20PRODUCTION-000000?style=for-the-badge&logo=vercel)
![Chrome Extension](https://img.shields.io/badge/Chrome%20Extension-Manifest%20V3-FF3366?style=for-the-badge)
![FUE University](https://img.shields.io/badge/University-Future%20University%20in%20Egypt%20(FUE)-B31B1B?style=for-the-badge)

🌐 **الرابط المباشر للإنتاج (Live Production):** [https://avqr-matany-fue.vercel.app](https://avqr-matany-fue.vercel.app)  
📑 **بوابة كشف حضور FUE التجريبية:** [https://avqr-matany-fue.vercel.app/portal/](https://avqr-matany-fue.vercel.app/portal/)

نظام الحضور الذكي المتكامل للجامعات والمحاضرات الضخمة، مصمم خصيصاً للقضاء على تسجيل الغياب اليدوي وإلغاء الحاجة لضغط الدكتور على مربعات الاختيار (Checkboxes) لكل طالب على حدة، بنسبة خطأ **0.0%**.

---

## ⚡ فكرة النظام ومميزاته الرئيسية

1. **إضافة متصفح كروم الذكية (AVQR Chrome Extension)**:
   - تنزل على أي متصفح في العالم بضغطة زر (Chrome, Brave, Edge).
   - تعرض كود QR ذكي متغير وديناميكي (Rotating Dynamic QR) على شاشة الدكتور أو البروجيكتور يتغير كل **8 ثوانٍ** مع تشفير HMAC لمنع الغش وتمرير الصور بين الطلاب.
   - تستمع فورياً لوصول تسجيلات الطلاب، وتبحث في جدول الحضور المفتوح في المتصفح عن رقم الطالب (ID) أو اسمه وتضع علامة الصح على الـ **Checkbox** تلقائياً في ثوانٍ.
   - **مؤقت الحفظ التلقائي (3-Minute Auto-Save)**: بعد 3 دقائق من بدء الجلسة، تضغط الإضافة تلقائياً على زر حفظ كشف الغياب دون تدخل يدوي.

2. **تطبيق ويب جوال فائق السرعة للطلاب (AVQR Mobile Portal)**:
   - تصميم **Neubrutalism** أسطوري ومبسط مستوحى من فلسفة `upstore.one`.
   - مسار حضور ثلاثي الخطوات:
     - **الخطوة 1 (مرة واحدة)**: تسجيل الدخول بالرقم الجامعي (مثال: `20264712`) وكلمة سر اختيارية، مع تفعيل تسجيل الدخول السريع بالبصمة البيومترية (WebAuthn / TouchID / FaceID).
     - **الخطوة 2 (مرة واحدة فقط وتُحفظ للأبد)**: مسح كود QR كارنيه الجامعة الرسمي (FUE ID)، حيث يقوم السيرفر فورياً بجلب الاسم الرباعي المعتمد والكلية والفرقة من بوابة FUE (`services.fue.edu.eg/FueCards/StudentCard.aspx?SS=...`) وتوثيقه للأبد.
     - **الخطوة 3 (في كل محاضرة)**: مسح الـ QR الديناميكي المعروض على البروجيكتور؛ فيتم تسجيل الحضور فورياً وظهور علامة الحضور على شاشة الطالب وشاشة الدكتور بنسبة خطأ 0%.

3. **سيرفر فائق السرعة وقاعدة بيانات Neon.tech السحابية**:
   - بنية Serverless PostgreSQL مع مزامنة أحداث لحظية عبر Server-Sent Events (SSE).
   - حماية متعددة الطبقات مع خيارات تواصل ودعم مباشر مع إدارة الجامعة و Matany Group.

---

## 📸 صورة كود كارنيه طالب FUE المعتمد

تم اختبار النظام واعتماده بالرابط الرسمي المشفر لكارنيه طالب كلية الهندسة:
- **الرقم الجامعي:** `20264712`
- **الاسم المعتمد:** `Mohamed Ahmed Mohamed Matany Ahmed`
- **الكلية والفرقة:** `Engineering` - `1-First`
- **رابط الكارنيه:** `https://services.fue.edu.eg/FueCards/StudentCard.aspx?SS=cc011cc7-ceb7-4867-973a-79d0a44e5214`

---

## 🚀 طريقة التشغيل والتجربة في 3 دقائق

### 1. تشغيل السيرفر وتطبيق الويب
```bash
cd server
npm install
npm run build
npm start
```
سيعمل السيرفر فوراً على المنفذ `3001` ويقدم:
- 📱 **تطبيق هاتف الطالب:** `http://localhost:3001/`
- 📑 **بوابة محاكاة كشف حضور FUE:** `http://localhost:3001/portal/`
- 📽️ **شاشة عرض البروجيكتور للـ QR:** `http://localhost:3001/ext/presenter.html?sessionId=AVQR-DEMO01`

### 2. تثبيت إضافة كروم (Chrome Extension)
1. افتح متصفح Google Chrome واذهب إلى: `chrome://extensions/`
2. فعّل وضع المطورين (**Developer mode**) في أعلى اليمين.
3. اضغط على زر **Load unpacked**.
4. اختر مجلد `extension` الموجود داخل المشروع: `C:\Projects\AVQT\extension`.
5. ستظهر إضافة **AVQR** فورياً في شريط أدوات كروم!

### 3. تجربة السيناريو العملي المتكامل:
1. افتح صفحة جدول الحضور: `http://localhost:3001/portal/`
2. اضغط على أيقونة إضافة **AVQR** في كروم واضغط على **"⚡ تفعيل الرصد التلقائي في الصفحة"**.
3. افتح تطبيق الطالب: `http://localhost:3001/` واضغط على **"⚡ تسجيل الحضور الفوري في الجلسة الحالية (Demo)"** أو امسح كود الشاشة.
4. شاهد إضافة كروم وهي تقوم فورياً بوضع علامة الصح على الـ **Checkbox** الخاص بالطالب `20264712 (Mohamed Ahmed Mohamed Matany Ahmed)` وتغيير حالته إلى **حاضر ✅**!
5. انتظر انتهاء مؤقت الـ 3 دقائق أو اضغط زر **"حفظ كشف الغياب فوراً"** لمشاهدة إتمام الحفظ الآلي بنسبة خطأ 0%!

---

## 🧪 تشغيل الاختبارات المؤتمتة (Automated Tests)
```bash
cd server
npm test
```
تغطي الاختبارات:
- التحقق من تشفير وتدوير الـ Dynamic QR ومنع الغش بالأكواد القديمة.
- محاكاة واستخراج بيانات كارنيه FUE الرسمي بنجاح.
- دورة حياة تسجيل الحضور في قاعدة البيانات والتأكد من إتمام الخطوة 2 قبل السماح بالرصد.

---

## 🛡️ الدعم الفني والشراكة الاستراتيجية
- **المطور:** شركة **Matany Group**
- **التصميم:** **upstore.one**
- **الجهة الشريكة:** **جامعة المستقبل في مصر (Future University in Egypt - FUE)**
- **مستودع الكود:** [https://github.com/MohamedFC2A/AVQT.git](https://github.com/MohamedFC2A/AVQT.git)
