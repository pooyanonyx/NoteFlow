// HELD-OUT set for Smart linking: new pages and new notes (medicine, history, physics, literature; English and Persian) written AFTER the scorer, the lexicon
// and the thresholds were calibrated on smartlink-corpus.mjs, and labelled (by meaning) before any score was looked at. It exists to answer "does this work on
// text the calibration never saw?". Same labels as the calibration corpus (auto / suggest / related / trap / none). Do not tune the lexicon on it: when it is
// used for tuning it stops being a test. Add new held-out notes instead.

export const PAGES = {
  med: `Antibiotics kill bacteria or stop them from multiplying, but they have no effect on viruses. Overuse of antibiotics encourages resistant strains, which makes infections harder to treat. Vaccines train the immune system to recognise a pathogen by exposing it to a harmless piece or weakened form of the germ.

Type 2 diabetes develops when cells stop responding properly to insulin, so glucose accumulates in the blood. Regular exercise lowers blood pressure and strengthens the heart muscle. Sleep deprivation impairs memory, attention and decision making.

The printing press, introduced by Gutenberg around 1440, made books cheaper and spread literacy across Europe. The Renaissance revived interest in classical art and learning, beginning in fourteenth century Italy. The Industrial Revolution moved production from small workshops to factories powered by steam engines. Urbanisation accelerated as workers left farms to find jobs in the growing factory towns.

The Treaty of Versailles imposed heavy reparations on Germany after the First World War, fuelling resentment. The Cold War was a long period of political tension between the United States and the Soviet Union without direct fighting.`,

  phys: `Newton's second law states that the acceleration of an object is proportional to the net force acting on it and inversely proportional to its mass. Light travels at roughly 300,000 kilometres per second in a vacuum, and nothing can move faster. Sound needs a medium such as air or water to propagate, which is why it cannot travel through a vacuum.

Ohm's law says that the current through a conductor is proportional to the voltage across it, with resistance as the constant of proportionality. A magnet has two poles, and like poles repel each other while opposite poles attract. Entropy measures disorder, and in an isolated system it never decreases.

Rivers erode valleys over thousands of years by carrying sediment downstream and depositing it in deltas. The Amazon rainforest produces a large share of the world's oxygen and shelters millions of species. Climate change is driven mainly by greenhouse gases such as carbon dioxide, which trap heat in the atmosphere. Tides are caused by the gravitational pull of the moon and, to a lesser extent, the sun on the oceans.

Shakespeare wrote tragedies such as Hamlet and Macbeth, as well as comedies and historical plays. In a sonnet, the poet fits fourteen lines into a strict rhyme scheme.`,

  fa3: `آنتی‌بیوتیک‌ها باکتری‌ها را می‌کشند یا از تکثیر آن‌ها جلوگیری می‌کنند، اما روی ویروس‌ها اثری ندارند. مصرف بیش از حد آنتی‌بیوتیک باعث پیدایش سویه‌های مقاوم می‌شود و درمان عفونت‌ها را دشوارتر می‌کند. واکسن با نشان دادن بخشی بی‌خطر یا شکل ضعیف‌شده میکروب به دستگاه ایمنی، به آن یاد می‌دهد عامل بیماری‌زا را بشناسد.

دیابت نوع دو زمانی ایجاد می‌شود که سلول‌ها به‌درستی به انسولین پاسخ نمی‌دهند و قند در خون انباشته می‌شود. ورزش منظم فشار خون را کاهش می‌دهد و ماهیچه قلب را تقویت می‌کند. کم‌خوابی حافظه، توجه و تصمیم‌گیری را مختل می‌کند.

اختراع چاپ توسط گوتنبرگ در حدود سال ۱۴۴۰ کتاب‌ها را ارزان‌تر کرد و سواد را در سراسر اروپا گسترش داد. انقلاب صنعتی تولید را از کارگاه‌های کوچک به کارخانه‌هایی منتقل کرد که با موتور بخار کار می‌کردند.

معاهده ورسای پس از جنگ جهانی اول غرامت‌های سنگینی بر آلمان تحمیل کرد و نارضایتی را دامن زد. جنگ سرد دوره‌ای طولانی از تنش سیاسی میان ایالات متحده و اتحاد شوروی بود که به درگیری مستقیم نینجامید.`,

  fa4: `قانون دوم نیوتن بیان می‌کند که شتاب یک جسم با نیروی خالص وارد بر آن نسبت مستقیم و با جرم آن نسبت وارونه دارد. نور در خلأ با سرعت تقریباً سیصد هزار کیلومتر بر ثانیه حرکت می‌کند و هیچ چیز نمی‌تواند سریع‌تر از آن باشد. صوت برای انتشار به محیطی مانند هوا یا آب نیاز دارد و به همین دلیل از خلأ عبور نمی‌کند.

قانون اهم می‌گوید جریان عبوری از یک رسانا با ولتاژ دو سر آن متناسب است و مقاومت ضریب این تناسب است. آهنربا دو قطب دارد؛ قطب‌های همنام یکدیگر را دفع و قطب‌های ناهمنام یکدیگر را جذب می‌کنند. آنتروپی معیار بی‌نظمی است و در یک سامانه منزوی هرگز کاهش نمی‌یابد.

رودخانه‌ها طی هزاران سال با حمل رسوب به سمت پایین‌دست و ته‌نشین کردن آن در دلتاها دره‌ها را فرسایش می‌دهند. تغییرات اقلیمی عمدتاً ناشی از گازهای گلخانه‌ای مانند دی‌اکسید کربن است که گرما را در جو نگه می‌دارند. جزر و مد در اثر نیروی گرانشی ماه و به میزان کمتر خورشید بر اقیانوس‌ها پدید می‌آید.

شکسپیر تراژدی‌هایی مانند هملت و مکبث و همچنین کمدی و نمایشنامه‌های تاریخی نوشت.`,
};

// [page, label, note, at]
export const CASES = [
  // ---- English: same statement, light edits
  ["med", "auto", "Antibiotics kill bacteria or stop them multiplying, but do nothing against viruses", /Antibiotics kill/],
  ["med", "auto", "Vaccines teach the immune system to recognise a pathogen by exposing it to a harmless piece or a weakened form of the germ", /Vaccines train/],
  ["phys", "auto", "Newton's second law: acceleration is proportional to the net force on an object and inversely proportional to its mass", /Newton's second law/],
  ["phys", "auto", "Tides are caused by the gravitational pull of the moon, and slightly less by the sun, on the oceans", /Tides are caused/],
  ["phys", "auto", "Ohm's law: the current in a conductor is proportional to the voltage across it, and the resistance is the proportionality constant", /Ohm's law/],
  // ---- English: paraphrases
  ["med", "auto", "Using antibiotics too much leads to resistant strains, so infections become more difficult to cure", /Overuse of antibiotics/],
  ["med", "auto", "In type 2 diabetes the body's cells no longer respond well to insulin and glucose builds up in the blood", /Type 2 diabetes/],
  ["med", "auto", "Working out regularly reduces blood pressure and makes the heart muscle stronger", /Regular exercise/],
  ["med", "auto", "Gutenberg's printing press from about 1440 made books cheaper and helped literacy spread through Europe", /printing press/],
  ["med", "auto", "The Industrial Revolution shifted manufacturing from little workshops to steam-powered factories", /Industrial Revolution/],
  ["med", "auto", "After World War One the Treaty of Versailles forced Germany to pay large reparations, which bred resentment", /Treaty of Versailles/],
  ["med", "auto", "The Cold War was a prolonged political standoff between the USA and the Soviet Union that never turned into direct combat", /Cold War/],
  ["med", "auto", "The Renaissance began in Italy in the 1300s with a renewed interest in classical art and learning", /Renaissance/],
  ["phys", "auto", "Sound has to pass through a medium like air or water, so it can't go through a vacuum", /Sound needs a medium/],
  ["phys", "auto", "Rivers carve out valleys over thousands of years, moving sediment downstream and dropping it in deltas", /Rivers erode/],
  ["phys", "auto", "Hamlet and Macbeth are tragedies by Shakespeare, who also wrote comedies and plays about history", /Shakespeare wrote/],
  ["phys", "auto", "A sonnet squeezes fourteen lines into a fixed rhyme pattern", /sonnet/],
  ["phys", "auto", "Entropy is a measure of disorder, and it cannot go down in a closed system", /Entropy measures/],
  // ---- English: heavy rewordings
  ["med", "suggest", "Lack of sleep damages your memory, concentration and ability to make decisions", /Sleep deprivation/],
  ["med", "suggest", "Factory towns grew as workers moved off the farms looking for work", /Urbanisation/],
  ["phys", "suggest", "Light moves through empty space at around 300,000 km per second and nothing is faster", /Light travels/],
  ["phys", "suggest", "Greenhouse gases like CO2 hold heat in the atmosphere, which is the main driver of global warming", /Climate change/],
  ["phys", "suggest", "Magnets always have two poles: similar poles push each other away and different poles pull together", /magnet has two poles/],
  // ---- English: related / traps / unrelated
  ["med", "related", "Penicillin was the first antibiotic discovered, by Alexander Fleming in 1928", /Antibiotics kill/],
  ["med", "related", "Type 1 diabetes is an autoimmune condition in which the pancreas makes little or no insulin", /Type 2 diabetes/],
  ["phys", "related", "Newton's first law says an object stays at rest or keeps moving at constant velocity unless a force acts on it", /Newton's second law/],
  ["phys", "related", "Kirchhoff's laws describe how current and voltage behave in electrical circuits with several branches", /Ohm's law/],
  ["med", "trap", "She will treat the strain on her knee with ice, but infections of the knee need a doctor", /Overuse of antibiotics/],
  ["phys", "trap", "The moon party tides over until the sun sets, and the pull of the crowd at the ocean bar was strong", /Tides are caused/],
  ["med", "none", "I need to book a dentist appointment and renew my passport before the trip", null],
  ["med", "none", "Dinner ideas: rice with grilled vegetables and a lemon yoghurt sauce", null],
  ["phys", "none", "The football team trained twice this week and the coach was happy with the defence", null],
  ["phys", "none", "Remember to charge the laptop and bring the blue notebook to the library tomorrow", null],
  ["med", "none", "Flights to Italy were cheaper in March, so we booked early", null],
  ["phys", "none", "My sister plays the violin in an orchestra and loves reading about history", null],

  // ---- Persian
  ["fa3", "auto", "آنتی‌بیوتیک‌ها باکتری‌ها را می‌کشند یا جلوی تکثیرشان را می‌گیرند ولی بر ویروس‌ها تأثیری ندارند", /آنتی‌بیوتیک‌ها باکتری/],
  ["fa4", "auto", "قانون دوم نیوتن: شتاب جسم با نیروی خالص وارد بر آن نسبت مستقیم و با جرمش نسبت وارونه دارد", /قانون دوم نیوتن/],
  ["fa4", "auto", "جزر و مد بر اثر کشش گرانشی ماه و کمی کمتر خورشید بر اقیانوس‌ها ایجاد می‌شود", /جزر و مد/],
  ["fa3", "auto", "مصرف زیاد آنتی‌بیوتیک‌ها سویه‌های مقاوم به وجود می‌آورد و معالجه عفونت‌ها سخت‌تر می‌شود", /مصرف بیش از حد/],
  ["fa3", "auto", "در دیابت نوع دو، سلول‌ها به انسولین درست واکنش نشان نمی‌دهند و قند خون بالا می‌رود", /دیابت نوع دو/],
  ["fa3", "auto", "ورزش کردن به طور منظم فشار خون را پایین می‌آورد و عضله قلب را قوی‌تر می‌کند", /ورزش منظم/],
  ["fa3", "auto", "گوتنبرگ حدود سال ۱۴۴۰ چاپ را اختراع کرد که کتاب را ارزان‌تر ساخت و سواد را در اروپا رواج داد", /اختراع چاپ/],
  ["fa3", "auto", "پس از جنگ جهانی اول، پیمان ورسای غرامت‌های سنگین بر آلمان تحمیل کرد که خشم و نارضایتی ایجاد کرد", /معاهده ورسای/],
  ["fa3", "auto", "جنگ سرد یک دوره طولانی تنش سیاسی بین آمریکا و شوروی بود که هرگز به جنگ مستقیم تبدیل نشد", /جنگ سرد/],
  ["fa4", "auto", "نور در خلأ تقریباً ۳۰۰ هزار کیلومتر در ثانیه می‌پیماید و هیچ چیزی سریع‌تر از آن نیست", /نور در خلأ/],
  ["fa4", "auto", "رودخانه‌ها در طول هزاران سال دره‌ها را می‌سایند، رسوبات را به پایین‌دست می‌برند و در دلتا می‌ریزند", /رودخانه‌ها طی/],
  ["fa4", "auto", "هملت و مکبث تراژدی‌های شکسپیر هستند و او کمدی و نمایشنامه‌های تاریخی هم نوشته است", /شکسپیر/],
  ["fa4", "auto", "آنتروپی اندازه بی‌نظمی است و در سامانه بسته هیچ‌گاه کم نمی‌شود", /آنتروپی/],
  ["fa4", "suggest", "صدا برای رسیدن از جایی به جای دیگر به یک ماده مثل هوا یا آب احتیاج دارد، پس در خلأ منتشر نمی‌شود", /صوت برای انتشار/],
  ["fa4", "suggest", "گازهای گلخانه‌ای همچون CO2 گرما را در جو حبس می‌کنند و عامل اصلی گرمایش جهانی‌اند", /تغییرات اقلیمی/],
  ["fa4", "suggest", "آهنربا دو قطب دارد و قطب‌های مشابه یکدیگر را می‌رانند ولی قطب‌های مخالف همدیگر را می‌کشند", /آهنربا دو قطب/],
  ["fa3", "related", "پنی‌سیلین نخستین آنتی‌بیوتیکی بود که فلمینگ در سال ۱۹۲۸ کشف کرد", /آنتی‌بیوتیک‌ها باکتری/],
  ["fa4", "related", "قانون اول نیوتن می‌گوید جسمی که ساکن است ساکن می‌ماند مگر نیرویی بر آن وارد شود", /قانون دوم نیوتن/],
  ["fa3", "related", "طرح مارشال کمک‌های اقتصادی به اروپای غربی پس از جنگ جهانی دوم بود", /معاهده ورسای|اختراع چاپ/],
  ["fa3", "trap", "ویروس‌ها در رایانه‌ها هم مثل باکتری‌ها نیستند و آنتی‌ویروس باید به‌روز بماند", /آنتی‌بیوتیک‌ها باکتری/],
  ["fa3", "none", "فردا باید کتاب‌ها را به کتابخانه پس بدهم و بلیط قطار را بگیرم", null],
  ["fa4", "none", "برای شام برنج با سبزیجات کبابی و ماست درست می‌کنم", null],
  ["fa3", "none", "تیم فوتبال این هفته دو بار تمرین کرد و مربی از دفاع راضی بود", null],
  ["fa4", "none", "ساعت هفت صبح بیدار شدم و با دوستم برای دویدن به پارک رفتیم", null],
];
