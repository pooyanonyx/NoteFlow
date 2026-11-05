// Calibration corpus for Smart linking: realistic PDF pages (10-12 sentences each, so rarity weights are active like on a real page) and notes written
// the way a student would write them. Every note is labelled BY MEANING (decided before looking at any score), never by what the scorer says:
//   auto     the note says the same thing as the passage in other words: it should be linked on its own (AUTO mode) and of course suggested
//   suggest  a loose / heavy rewording of the same statement: it must at least be suggested; linking it on its own is fine but not required
//   related  same topic, but a different fact or a contrast: may be suggested, must NOT be linked on its own
//   trap     shares several words with a passage but means something else: must NOT be linked on its own (a suggestion is tolerated, it is a coin flip even for people)
//   none     unrelated (or shares one or two ordinary words): no suggestion at all
// `at` is a regular expression that the right passage must match (checked on the text of the passage that was found).

export const PAGES = {
  mix: `The project budget is divided between the finance team and the engineering team for each quarter of the planning cycle. Deep learning models need a large amount of training data, and accuracy depends on how data is cleaned and labelled. An AVL tree is a self balancing binary search tree where insertion requires rotations to keep the height logarithmic. TCP is a connection oriented protocol that uses a handshake and acknowledgment to guarantee delivery of segments. Compost needs a balance of green and brown material, regular turning and enough moisture to break down. Seedlings are hardened off by exposing them to outdoor conditions gradually over a week.`,
  fa5: `هر شبکه عصبی شامل چندین لایه است و هر لایه از نورون‌ها ساخته می‌شود. داده‌های آموزشی باید پیش از استفاده پاکسازی و برچسب‌گذاری شوند. درخت دودویی جستجو عملیات درج را در زمان لگاریتمی انجام می‌دهد.`,
  cs: `Firewalls filter network traffic according to security rules. A stateful firewall tracks the state of active connections and decides which packets are allowed. The TCP handshake establishes a reliable connection between two hosts using three steps: the client sends SYN, the server answers with SYN-ACK, and the client confirms with ACK. Encryption protects data in transit. Public key cryptography lets two parties exchange secrets over an untrusted channel. Intrusion detection systems monitor networks for suspicious activity and report policy violations.

A hash table stores key-value pairs and finds an entry in constant time on average by computing an index from the key. Collisions occur when two keys map to the same slot, and they are resolved by chaining or open addressing. Binary search repeatedly halves a sorted array, so it finds an element in logarithmic time.

A relational database organizes data into tables with rows and columns, and SQL queries retrieve or modify the records. Normalization removes redundancy from a schema by splitting data across related tables. Garbage collection automatically reclaims memory that a program no longer uses.`,

  sci: `Mitochondria convert glucose and oxygen into ATP, the molecule that cells use as a portable source of energy. Most of this ATP is produced along the inner membrane through oxidative phosphorylation. Photosynthesis takes place in chloroplasts, where chlorophyll absorbs sunlight and drives the conversion of carbon dioxide and water into sugar and oxygen.

Inflation is a sustained rise in the general price level, which reduces the purchasing power of money over time. Central banks respond by raising interest rates to slow borrowing and spending. According to the law of demand, when the price of a good increases, consumers buy less of it, all other things being equal. The supply curve slopes upward because producers are willing to sell more at higher prices.

The French Revolution began in 1789 and overthrew the monarchy. Economic hardship, food shortages and resentment of aristocratic privilege fuelled popular anger against the king.

Neurons communicate through electrical impulses along the axon and chemical signals at synapses. At a synapse, neurotransmitters cross the gap between cells and bind to receptors on the next neuron. Plate tectonics explains how the rigid pieces of the Earth's crust move slowly over the mantle, causing earthquakes and volcanoes at their boundaries.`,

  fa1: `میتوکندری‌ها گلوکز و اکسیژن را به ATP تبدیل می‌کنند؛ مولکولی که سلول‌ها به عنوان منبع انرژی قابل حمل از آن استفاده می‌کنند. بخش عمده این ATP در غشای داخلی و از طریق فسفریلاسیون اکسایشی تولید می‌شود. فتوسنتز در کلروپلاست‌ها انجام می‌شود، جایی که کلروفیل نور خورشید را جذب می‌کند و دی‌اکسید کربن و آب را به قند و اکسیژن تبدیل می‌کند.

تورم افزایش پایدار سطح عمومی قیمت‌هاست که با گذشت زمان قدرت خرید پول را کاهش می‌دهد. بانک‌های مرکزی برای مهار تورم نرخ بهره را بالا می‌برند تا وام‌گیری و مخارج کاهش یابد. بر اساس قانون تقاضا، وقتی قیمت یک کالا افزایش پیدا می‌کند، مصرف‌کنندگان کمتر از آن می‌خرند. منحنی عرضه صعودی است زیرا تولیدکنندگان در قیمت‌های بالاتر حاضرند بیشتر بفروشند.

انقلاب فرانسه در سال ۱۷۸۹ آغاز شد و نظام پادشاهی را سرنگون کرد. سختی‌های اقتصادی، کمبود غذا و نارضایتی از امتیازات اشراف خشم مردم را علیه پادشاه برانگیخت.

نورون‌ها از طریق تکانه‌های الکتریکی در طول آکسون و پیام‌های شیمیایی در سیناپس‌ها با یکدیگر ارتباط برقرار می‌کنند. در سیناپس، انتقال‌دهنده‌های عصبی از شکاف بین سلول‌ها عبور می‌کنند و به گیرنده‌های نورون بعدی متصل می‌شوند. زمین‌ساخت ورقه‌ای توضیح می‌دهد که قطعات سخت پوسته زمین به آرامی بر روی گوشته حرکت می‌کنند و در مرزهای آن‌ها زلزله و آتشفشان رخ می‌دهد.`,

  fa2: `دیوار آتش ترافیک شبکه را بر اساس قوانین امنیتی فیلتر می‌کند. رمزنگاری از داده‌ها در هنگام انتقال محافظت می‌کند. رمزنگاری کلید عمومی به دو طرف اجازه می‌دهد بر روی یک کانال ناامن اسرار را مبادله کنند. سامانه‌های تشخیص نفوذ فعالیت‌های مشکوک شبکه را پایش می‌کنند و تخلفات از سیاست امنیتی را گزارش می‌دهند.

جدول هش جفت‌های کلید و مقدار را ذخیره می‌کند و با محاسبه شاخص از روی کلید، یک مدخل را به طور میانگین در زمان ثابت پیدا می‌کند. جستجوی دودویی آرایه مرتب را مدام نصف می‌کند، بنابراین عنصر را در زمان لگاریتمی پیدا می‌کند.

پایگاه داده اطلاعات را در جدول‌هایی با سطر و ستون سازمان‌دهی می‌کند و با زبان SQL رکوردها بازیابی یا تغییر داده می‌شوند. نرمال‌سازی با تقسیم داده‌ها بین جدول‌های مرتبط، افزونگی را از طرح پایگاه داده حذف می‌کند. بازیابی خودکار حافظه، حافظه‌ای را که برنامه دیگر استفاده نمی‌کند آزاد می‌کند. پروتکل TCP پیش از ارسال داده‌ها با سه مرحله اتصال میان دو میزبان برقرار می‌کند.`,
};

// [page, label, note, at]
export const CASES = [
  // ------------------------------------------------------------------ English: same statement, light edits
  ["cs", "auto", "The TCP handshake takes three steps: client sends SYN, server replies SYN-ACK, client confirms with ACK", /TCP handshake/],
  ["cs", "auto", "Hash tables store key-value pairs and look up an entry in constant time on average by computing an index from the key", /hash table/i],
  ["cs", "auto", "Binary search halves a sorted array at every step, so finding an element takes logarithmic time", /Binary search/],
  ["sci", "auto", "Mitochondria turn glucose and oxygen into ATP, a portable source of energy for cells", /Mitochondria/],
  ["sci", "auto", "Photosynthesis happens in the chloroplasts, where chlorophyll absorbs sunlight to turn carbon dioxide and water into sugar and oxygen", /Photosynthesis/],
  // ------------------------------------------------------------------ English: paraphrases (same statement, a good part of the words changed)
  ["cs", "auto", "Firewalls block or allow network traffic by applying security rules", /Firewalls filter/],
  ["cs", "auto", "Two sides can share secrets across an insecure channel using public-key cryptography", /Public key cryptography/],
  ["cs", "auto", "Intrusion detection software watches a network for suspicious behaviour and reports violations of policy", /Intrusion detection/],
  ["cs", "auto", "When two keys end up in the same slot of a hash table that is a collision, handled by chaining or open addressing", /Collisions/],
  ["cs", "auto", "A database keeps information in tables made of rows and columns and is queried with SQL", /relational database/i],
  ["cs", "auto", "Splitting data over linked tables to eliminate duplication is called normalization", /Normalization/],
  ["sci", "auto", "Inflation is a lasting increase in the overall price level, so money loses purchasing power as time passes", /Inflation is/],
  ["sci", "auto", "To fight inflation, central banks increase interest rates, which slows lending and consumer spending", /Central banks/],
  ["sci", "auto", "Producers will supply more when prices are higher, which makes the supply curve rise to the right", /supply curve/],
  ["sci", "auto", "The French Revolution started in 1789 and toppled the monarchy", /French Revolution/],
  ["sci", "auto", "Neurons use electric impulses travelling along the axon and chemical messengers at synapses to talk to each other", /Neurons communicate/],
  ["sci", "auto", "Neurotransmitters pass over the synaptic gap and attach to receptors of the neighbouring neuron", /neurotransmitters cross/],
  ["sci", "suggest", "The law of demand says that if a good costs more, people purchase less of it, everything else unchanged", /law of demand/],
  // ------------------------------------------------------------------ English: heavy rewordings (few words shared)
  ["sci", "suggest", "Money buys less and less when the general level of prices keeps climbing", /Inflation is/],
  ["sci", "suggest", "Hunger, economic difficulties and anger at noble privileges pushed ordinary people against the king", /hardship/],
  ["cs", "suggest", "Checking an ordered list by repeatedly cutting it in half is very fast, taking logarithmic time", /Binary search/],
  ["cs", "suggest", "Memory that nobody uses any more is freed by the runtime without the programmer doing anything", /Garbage collection/],
  ["sci", "suggest", "The Earth's outer shell is broken into slabs that drift slowly over the layer beneath, so quakes and eruptions happen along their edges", /Plate tectonics/],
  // ------------------------------------------------------------------ English: related, other fact / contrast (never on its own)
  ["cs", "related", "A stateless packet filter inspects each packet on its own, without tracking connections", /stateful firewall/],
  ["cs", "related", "The TCP connection teardown takes four steps: each side sends FIN and the other side replies with ACK", /TCP handshake/],
  ["cs", "related", "Open addressing resolves collisions by probing other slots, whereas chaining keeps a linked list per slot", /Collisions/],
  ["sci", "related", "Deflation is a fall in the general price level, which raises the real value of debts and tends to discourage spending", /Inflation is/],
  // ------------------------------------------------------------------ English: lexical traps (words in common, other meaning)
  ["cs", "trap", "The client asked us to send the invoice and confirm the steps of the delivery schedule", /TCP handshake/],
  ["cs", "trap", "Garbage collection in our park happens on Tuesdays, so put the bins out the night before", /Garbage collection/],
  ["sci", "trap", "Our team will overthrow last year's sales record in the central region by raising prices and borrowing less", /Central banks|supply curve/],
  // ------------------------------------------------------------------ English: unrelated
  ["cs", "none", "Buy milk, eggs and bread at the supermarket tomorrow evening", null],
  ["cs", "none", "The network of my friends is growing quickly this summer", null],
  ["cs", "none", "Remember to review the project budget with the finance team before the quarterly planning meeting", null],
  ["cs", "none", "Key lime pie needs a graham cracker crust and sweet condensed milk", null],
  ["sci", "none", "My neighbour grows tomatoes and sunflowers in his garden every summer", null],
  ["sci", "none", "The price of my train ticket to the conference went up again this month", null],
  ["sci", "none", "Cells in a spreadsheet can hold formulas, and the energy of the team was great this week", null],

  // ------------------------------------------------------------------ Persian: same statement, light edits
  ["fa1", "auto", "میتوکندری گلوکز و اکسیژن را به ATP تبدیل می‌کند و سلول از آن به عنوان منبع انرژی بهره می‌برد", /میتوکندری/],
  ["fa1", "auto", "فتوسنتز در کلروپلاست رخ می‌دهد و کلروفیل نور خورشید را جذب می‌کند تا دی‌اکسید کربن و آب به قند و اکسیژن تبدیل شود", /فتوسنتز/],
  ["fa2", "auto", "دیوار آتش ترافیک شبکه را طبق قوانین امنیتی فیلتر می‌کند", /دیوار آتش/],
  // ------------------------------------------------------------------ Persian: paraphrases
  ["fa1", "auto", "تورم یعنی بالا رفتن مداوم قیمت‌ها که با گذشت زمان توان خرید پول را پایین می‌آورد", /تورم افزایش/],
  ["fa1", "auto", "بانک مرکزی برای کنترل تورم نرخ بهره را افزایش می‌دهد تا وام و هزینه‌ها کم شود", /بانک‌های مرکزی/],
  ["fa1", "auto", "تولیدکنندگان وقتی قیمت بالاتر است مایلند بیشتر عرضه کنند و به همین دلیل منحنی عرضه رو به بالاست", /منحنی عرضه/],
  ["fa1", "auto", "انقلاب فرانسه از سال ۱۷۸۹ شروع شد و حکومت سلطنتی را برانداخت", /انقلاب فرانسه/],
  ["fa1", "auto", "گرسنگی، دشواری‌های اقتصادی و خشم از امتیازهای اشراف مردم را به مخالفت با پادشاه کشاند", /سختی‌های اقتصادی/],
  ["fa1", "auto", "نورون‌ها با تکانه‌های الکتریکی که در طول آکسون حرکت می‌کنند و با پیام‌های شیمیایی در سیناپس با هم ارتباط دارند", /نورون‌ها از طریق/],
  ["fa1", "auto", "ناقل‌های عصبی از فاصله میان سلول‌ها می‌گذرند و به گیرنده‌های نورون بعدی می‌چسبند", /انتقال‌دهنده/],
  ["fa2", "auto", "رمزنگاری کلید عمومی اجازه می‌دهد دو طرف روی کانال ناامن رازها را به اشتراک بگذارند", /رمزنگاری کلید عمومی/],
  ["fa2", "auto", "سیستم تشخیص نفوذ رفتارهای مشکوک در شبکه را زیر نظر می‌گیرد و نقض سیاست‌ها را اعلام می‌کند", /تشخیص نفوذ/],
  ["fa2", "auto", "در جدول هش داده‌ها به صورت جفت کلید و مقدار نگهداری می‌شوند و با ساختن شاخص از کلید، پیدا کردن مدخل به طور متوسط در زمان ثابت انجام می‌شود", /جدول هش/],
  ["fa2", "auto", "پایگاه داده اطلاعات را در قالب جدول با سطر و ستون نگه می‌دارد و با SQL می‌توان آن را خواند یا تغییر داد", /پایگاه داده اطلاعات/],
  ["fa2", "auto", "برای حذف تکرار و افزونگی داده‌ها، آن‌ها را میان جدول‌های وابسته تقسیم می‌کنند", /نرمال‌سازی/],
  ["fa1", "suggest", "طبق قانون تقاضا اگر کالایی گران شود خریداران کمتر از آن می‌خرند", /قانون تقاضا/],
  // ------------------------------------------------------------------ Persian: heavy rewordings
  ["fa2", "suggest", "حافظه‌ای که دیگر کسی از آن استفاده نمی‌کند توسط سیستم اجرا بدون دخالت برنامه‌نویس آزاد می‌شود", /بازیابی خودکار حافظه/],
  ["fa2", "suggest", "الگوریتمی که فهرست مرتب را هر بار نصف می‌کند خیلی سریع است", /جستجوی دودویی/],
  ["fa1", "suggest", "ورقه‌های سنگی بیرونی کره زمین آهسته روی لایه زیرین جابه‌جا می‌شوند و کنار لبه‌هایشان زمین‌لرزه و فوران رخ می‌دهد", /زمین‌ساخت/],
  // ------------------------------------------------------------------ Persian: related / traps / unrelated
  ["fa2", "related", "پروتکل TCP برای بستن اتصال چهار مرحله دارد و هر طرف پیام پایان می‌فرستد", /پروتکل TCP/],
  ["fa1", "related", "کاهش مداوم سطح عمومی قیمت‌ها را کاهش قیمت یا ضد تورم می‌نامند و باعث کم شدن مخارج می‌شود", /تورم افزایش/],
  ["fa2", "trap", "مدیر شبکه اجتماعی امروز رمز عبور من را عوض کرد و گزارش داد که حساب مشکوک بوده است", /دیوار آتش|تشخیص نفوذ/],
  ["fa1", "none", "قیمت بلیط قطار به کنفرانس این ماه دوباره بالا رفت", null],
  ["fa1", "none", "فردا باید برای شام نان و پنیر و سبزی تازه از بازار بخرم", null],
  ["fa2", "none", "امروز هوا بسیار خوب است و می‌خواهم به پارک بروم و ورزش کنم", null],
  ["fa2", "none", "کلید خانه را روی میز گذاشتم و جدول کارهای امروز را روی یخچال چسباندم", null],
  // ------------------------------------------------------------------ added after the first sweep: everyday notes that merely sit on the same subject
  ["mix", "related", "Remember to review the project budget with the finance team before the quarterly planning meeting", /project budget/],
  ["mix", "related", "Machine learning models need training data and validation data to measure accuracy", /Deep learning/],
  ["mix", "related", "Binary search tree insertion runs in logarithmic time on average", /AVL tree/],
  ["mix", "related", "UDP is a connectionless protocol that sends datagrams without any handshake or acknowledgment", /TCP is a connection/],
  ["mix", "auto", "Compost needs a mix of green and brown material, turning now and then and enough moisture to rot down", /Compost needs/],
  ["mix", "none", "Buy milk eggs bread and fresh vegetables tomorrow morning", null],
  ["fa5", "auto", "شبکه‌های عصبی از لایه‌های متعدد نورون تشکیل شده‌اند", /شبکه عصبی/],
  ["fa5", "related", "برای ارائه فردا باید داده‌های جلسه برنامه‌ریزی را با تیم مالی مرور کنم", /داده‌های آموزشی/],
];
