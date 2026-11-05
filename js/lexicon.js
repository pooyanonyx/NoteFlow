// Word knowledge for Smart linking (pure data, no code, no network): which different words mean the same thing, and which words say little.
//
// CONCEPTS: each line is a group of words that stand for one idea (English: rise / grow / climb / increase; Persian: افزایش / رشد / صعود). A note word and a passage
// word of the same group count as a (slightly weaker than exact) match, so a rewording like "toppled the monarchy" still finds "overthrew the monarchy".
// The groups are everyday and academic vocabulary on purpose: technical terms (mitochondria, encryption, تورم, نورون) normally survive a rewording and are
// matched exactly. A word may stand in several groups. Base forms are enough: similar.js applies the same stemming to these words as to the text; irregular
// forms (began, fell, sent ...) are listed.
//
// GENERIC: very common words that carry little about WHAT a text is about (thing, called, overall, یعنی, رفتن). They count, but less, so that sharing "send", "confirm"
// and "steps" with a passage about something else does not look like a match, and replacing "called" by "named" does not look like a different statement.
//
// To teach Smart linking a word, add it to a group (one line = one meaning) and run `node tools/calibrate-smartlink.mjs` to see what moves.

export const EN_CONCEPTS = `
increase rise raise grow growth climb surge expand expansion boost soar escalate swell rose risen grew grown
decrease decline fall fell fallen drop reduce reduction lower diminish shrink shrank cut lessen dwindle plunge
begin began begun start commence initiate launch
end finish conclude terminate complete cease halt stop
make made create produce generate build built construct form yield manufacture
use utilize utilise employ apply exploit harness
show display demonstrate illustrate reveal indicate exhibit
explain describe clarify interpret
allow permit enable authorise authorize
prevent avoid hinder obstruct prohibit forbid
filter block screen restrict
protect guard defend shield safeguard secure preserve safe
send sent transmit transfer deliver dispatch forward convey relay
receive obtain acquire gain collect
find found locate discover detect identify spot
watch monitor observe track supervise
inspect examine scrutinize investigate
check verify validate confirm acknowledge test
change modify alter adjust vary revise amend edit
convert transform turn translate
split divide separate partition segment
remove delete eliminate erase discard purge eradicate omit
connect link join attach bind unite couple
move shift travel migrate drift proceed
keep store save retain hold maintain
free release reclaim liberate
gap interval space distance
share exchange swap
communicate talk converse interact
cause trigger induce provoke spark prompt
result outcome consequence effect
help assist aid support facilitate
try attempt endeavor seek aim
overthrow overthrew overthrown topple depose oust overturn
push drive propel force motivate compel
fight combat counter resist oppose curb
slow delay retard restrain decelerate
control regulate govern manage direct administer
buy purchase procure
cost price fee charge expense
money cash currency funds
loan borrow lend credit debt mortgage lending borrowing
consumer customer buyer shopper
people person individuals humans citizens public
big large huge enormous vast massive substantial considerable
small tiny little minor miniature
fast quick rapid swift speedy brisk
slowly gradually steadily
quickly rapidly swiftly promptly
important significant crucial vital essential critical
good beneficial favorable favourable positive advantageous
bad harmful negative adverse detrimental damaging
difficulty hardship adversity struggle trouble misery distress
anger rage fury outrage resentment wrath indignation
noble aristocrat aristocratic aristocracy nobility elite gentry
hunger starvation famine malnutrition
shortage scarcity lack deficiency shortfall
general overall broad universal widespread
sustain sustained continuous continual lasting persistent prolonged enduring ongoing steady constant perpetual
sorted ordered arranged ranked sequenced
array list sequence series
element item entry member
half halve halves halving
redundancy duplication duplicate repetition redundant
related linked associated correlated dependent relevant
organize organise arrange structure systematize
neighbouring neighboring adjacent nearby
ordinary common regular typical usual normal everyday
cross traverse pass span
outer exterior external outside
inner interior internal inside
edge boundary border margin rim
quake earthquake tremor
doctor physician clinician
illness disease sickness ailment disorder
medicine drug medication remedy pharmaceutical
treat cure heal therapy treatment
pain ache soreness discomfort
child kid youngster
teacher instructor educator professor lecturer
student pupil learner
house home dwelling residence
car automobile vehicle
company firm business corporation enterprise
government authorities administration regime
law statute legislation regulation
rule policy guideline
danger risk hazard threat peril
mistake error fault flaw defect
wrong incorrect false mistaken
rich wealthy affluent
poor impoverished needy
cheap inexpensive affordable
expensive costly pricey
strong powerful robust sturdy
weak feeble fragile frail
hot warm heated
cold cool chilly freezing
happy glad pleased joyful cheerful
sad unhappy sorrowful depressed
afraid scared fearful frightened terrified
smart intelligent clever brilliant
rare scarce uncommon infrequent
whole entire full total
part portion piece fragment section component slab
guess estimate approximate assume suppose
idea concept notion
goal objective target purpose
method approach technique procedure
tool instrument device gadget
machine engine apparatus
speed velocity pace
amount quantity
many numerous multiple various
enough sufficient adequate
obvious evident apparent plain
famous renowned celebrated notable
ancient old archaic
modern contemporary current recent
past previous former earlier prior
remember recall recollect
think believe consider reckon
want desire wish crave
hate dislike detest loathe
ask inquire request
answer reply respond response
inform notify announce report declare
run operate execute
happen occur arise
appear emerge
leave depart exit quit
arrive reach
break shatter smash crack fracture
fix repair mend restore
combine merge mix blend
choose select pick elect
decide determine settle
rely depend
need require necessitate
possible feasible viable achievable
simple easy straightforward
hard difficult tough challenging arduous
enemy foe adversary opponent
friend companion ally
`;

export const FA_CONCEPTS = `
افزایش رشد صعود ازدیاد فزونی ترقی
کاهش افت تنزل نزول کسر کاستن
آغاز شروع ابتدا
پایان اتمام خاتمه انتها
ایجاد تولید ساخت ساز ساختن ساخته آفرینش خلق تشکیل
استفاده کاربرد بهره‌برداری بهره‌گیری به‌کارگیری بهره
نمایش نشان ارائه بیان
اجازه مجوز امکان
مهار کنترل مدیریت تنظیم
محافظت حفاظت حفظ دفاع صیانت مراقبت
ارسال انتقال فرستادن نقل فرستاد
ناقل انتقال‌دهنده حامل
نظارت پایش رصد
تشخیص شناسایی کشف
گزارش اعلام اطلاع‌رسانی ابلاغ
تخلف نقض سرپیچی
سامانه سیستم
فعالیت رفتار عملکرد کنش
راز اسرار
مبادله تبادل اشتراک تعویض
ناامن ناایمن نامطمئن
امن ایمن امنیت ایمنی
مشکوک مظنون
ثابت پایدار دائمی مداوم پیوسته مستمر همیشگی
قدرت توان نیرو توانایی
هزینه مخارج خرج
وام وام‌گیری قرض اعتبار
خریدار مصرف‌کننده مشتری
قانون قوانین قاعده ضابطه
سخت دشوار مشکل سختی دشواری
خشم غضب خشمگین
اشراف نجبا اشرافی اعیان
امتیاز مزیت
پادشاه شاه سلطان سلطنت پادشاهی
نظام حکومت رژیم
سرنگون برانداخت براندازی ساقط واژگون
مخالفت ضدیت اعتراض مقاومت
گرسنگی قحطی
کمبود قلت فقدان
حرکت جابجا جابه‌جا جابجایی
قطعه تکه ورقه قطعات
زلزله زمین‌لرزه
آتشفشان فوران
لبه مرز حاشیه کناره
آهسته آرامی
فهرست لیست آرایه
مرتب منظم
نصف نیمه نیم
سریع تند چابک
آزاد رها آزادسازی
شکاف فاصله
عبور گذر گذشتن
متصل اتصال پیوند چسب
بازیابی بازیافت
خودکار اتوماتیک خودبه‌خود
نگهداری ذخیره نگه
تغییر اصلاح ویرایش دگرگونی
تبدیل تحویل دگرگون
تقسیم تفکیک جداسازی
حذف پاک پاکسازی
تکرار افزونگی تکراری
مرتبط وابسته مربوط
عنصر مدخل
بیماری مرض
پزشک دکتر طبیب
دارو درمان
معلم مدرس استاد آموزگار
دانشجو دانش‌آموز شاگرد
خانه منزل
خودرو ماشین اتومبیل
شرکت بنگاه
خطر ریسک تهدید
اشتباه خطا
زیاد فراوان بسیاری
کم اندک کمی کمتر
بزرگ عظیم کلان
کوچک ریز خرد
مهم اساسی حیاتی ضروری
خوب مطلوب مناسب
بد ناخوشایند نامطلوب
فکر اندیشه تفکر
هدف مقصود غایت
روش شیوه رویکرد
ابزار وسیله
مقدار میزان
دلیل علت سبب
نتیجه پیامد
کمک یاری مساعدت
تلاش کوشش
جنگ نبرد
پیدا یافت یافتن
فهم درک
ساده آسان
شمار تعداد
کامل تمام تمامی
گروه دسته
مردم ملت جمعیت
جهان دنیا عالم
نور روشنایی
گرما حرارت
سرما برودت
`;

export const EN_GENERIC = `
said say says tell told ask asked take took taken give gave given go went gone going come came see saw seen look looked want wanted keep kept let seem seems become became
thing things way ways lot lots kind sort type part case point fact idea example number end side place problem question group area line word name hand head person people man woman child life world
day days week month year years time times work works working good bad great big small large little long short high low old young new first last next early late whole real main same different easy hard
possible able certain several various particular usual clear full free right wrong best better worse enough almost always never often usually sometimes really quite rather already still even yet ever today
called call calls lasting overall know knew known think thought feel felt find found put set run ran turn begin began start started continue help helps need needs try tried show shows showed shown
important general common simple often later earlier following according due based including include includes included others another every either neither
`;

export const FA_GENERIC = `
چیز چیزی کار کارها روش نوع مورد موارد بخش حالت شکل تعداد مثال راه جا جای روز رفتن رفت آمدن آمد آورد آوردن گرفتن گرفت دادن داد بردن برد کردن کرد گفتن گفت دیدن دید بودن شدن خواستن خواست توانستن
بالا پایین زیاد کم خوب بد بزرگ کوچک اول آخر دیگر همین همان بسیار خیلی فقط حتی هنوز همیشه هرگز اغلب معمولا گاهی واقعا تقریبا اکنون امروز یعنی مثلا البته ولی تنها کنار طرف سمت درون بیرون داخل خارج
مایل مایلند بیشتر کمتر رو دلیل صورت شکلی سال ماه هفته
`;
