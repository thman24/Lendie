import { useState, useRef, useEffect } from "react";
import { supabase } from './supabase';

// --- OWNERS -------------------------------------------------------------------
const OWNERS = {
  marcus:  { id:"marcus",  name:"Marcus T.",    avatar:"👨🏾", joined:"Jan 2023", rating:4.9, reviews:47, bio:"Home handyman & tools enthusiast. Everything well-maintained.", verified:true,  superhost:false, responseTime:"< 30 min" },
  priya:   { id:"priya",   name:"Priya S.",     avatar:"👩🏽", joined:"Mar 2023", rating:4.8, reviews:29, bio:"Love cooking and sharing kitchen gear with neighbors!", verified:true,  superhost:false, responseTime:"< 1 hr" },
  jake:    { id:"jake",    name:"Jake L.",      avatar:"👨🏼", joined:"Jun 2022", rating:5.0, reviews:18, bio:"Garden enthusiast. Happy to help your yard shine.", verified:true,  superhost:true,  responseTime:"< 2 hr" },
  sofia:   { id:"sofia",   name:"Sofia R.",     avatar:"👩🏻", joined:"Aug 2023", rating:4.7, reviews:22, bio:"Outdoorsy family with tons of camping gear.", verified:true,  superhost:false, responseTime:"< 1 hr" },
  carl:    { id:"carl",    name:"Carl M.",      avatar:"👨🏻", joined:"Nov 2022", rating:4.6, reviews:31, bio:"DIY carpenter. Ladders, saws, drills - you name it.", verified:false, superhost:false, responseTime:"< 4 hr" },
  linda:   { id:"linda",   name:"Linda K.",     avatar:"👩🏿", joined:"Feb 2023", rating:4.9, reviews:55, bio:"Chef-level kitchen appliances for rent. High quality only.", verified:true,  superhost:true,  responseTime:"< 30 min" },
  tom:     { id:"tom",     name:"Tom B.",       avatar:"👨🏽", joined:"May 2023", rating:4.8, reviews:14, bio:"Water sports lover with kayaks and paddleboards.", verified:true,  superhost:false, responseTime:"< 2 hr" },
  grace:   { id:"grace",   name:"Grace Y.",     avatar:"👩🏼", joined:"Apr 2022", rating:4.7, reviews:20, bio:"Big yard, great tools. Mowers, blowers, and more.", verified:true,  superhost:false, responseTime:"< 1 hr" },
  derek:   { id:"derek",   name:"Derek F.",     avatar:"👨🏾", joined:"Jan 2024", rating:4.9, reviews:33, bio:"Commercial vehicle rentals. Fully insured, clean records.", verified:true,  superhost:true,  responseTime:"< 30 min" },
  yuki:    { id:"yuki",    name:"Yuki T.",      avatar:"👩🏻", joined:"Sep 2023", rating:5.0, reviews:11, bio:"Tech nerd with drones, cameras, and VR gear.", verified:true,  superhost:false, responseTime:"< 1 hr" },
  rosa:    { id:"rosa",    name:"Rosa M.",      avatar:"👩🏽", joined:"Oct 2022", rating:4.8, reviews:19, bio:"Event planner with tents, tables, chairs - everything.", verified:true,  superhost:false, responseTime:"< 2 hr" },
  millers: { id:"millers", name:"The Millers",  avatar:"👨🏻", joined:"Mar 2021", rating:4.9, reviews:78, bio:"200-year-old farm with restored barn. Host to hundreds of weddings.", verified:true,  superhost:true,  responseTime:"< 1 hr" },
  chen:    { id:"chen",    name:"Chen Family",  avatar:"👩🏻", joined:"Jul 2022", rating:4.7, reviews:45, bio:"Manicured garden estate for events & photo shoots.", verified:true,  superhost:true,  responseTime:"< 2 hr" },
  jay:     { id:"jay",     name:"Jay Park",     avatar:"👨🏽", joined:"Nov 2022", rating:4.8, reviews:36, bio:"NYC rooftop with stunning skyline views for events.", verified:true,  superhost:false, responseTime:"< 1 hr" },
  davis:   { id:"davis",   name:"Davis Ranch",  avatar:"👨🏾", joined:"Feb 2021", rating:5.0, reviews:22, bio:"Working ranch with farmhouse for retreats and reunions.", verified:true,  superhost:true,  responseTime:"< 30 min" },
  nguyen:  { id:"nguyen",  name:"Nguyen Fam.",  avatar:"👩🏽", joined:"Apr 2022", rating:4.9, reviews:56, bio:"Lakefront property with cabin, dock, and kayaks.", verified:true,  superhost:true,  responseTime:"< 1 hr" },
  sarah:   { id:"sarah",   name:"Sarah W.",     avatar:"👩🏼", joined:"Jan 2023", rating:4.9, reviews:43, bio:"Cozy home rentals. Spotless and well-stocked every time.", verified:true,  superhost:true,  responseTime:"< 30 min" },
  james:   { id:"james",   name:"James O.",     avatar:"👨🏿", joined:"Jun 2022", rating:4.8, reviews:61, bio:"Multiple properties across the neighborhood. Short-term stays welcome.", verified:true,  superhost:true,  responseTime:"< 1 hr" },
  mei:     { id:"mei",     name:"Mei L.",       avatar:"👩🏻", joined:"Mar 2023", rating:4.7, reviews:28, bio:"Bright modern loft perfect for artists and creatives.", verified:true,  superhost:false, responseTime:"< 2 hr" },
};

// --- HOUSING LISTINGS --------------------------------------------------------
const HOUSING_ITEMS = [
  { id:20, title:"Cozy Studio Loft",         ownerId:"sarah",  ownerAvatar:"👩🏼", owner:"Sarah W.",    distance:0.4, price:85,  priceUnit:"night", category:"housing", emoji:"🏢", color:"#8B5CF6", available:true,  rating:4.9, reviews:43, lat:40.7140, lng:-74.0065, booked:["2026-06-07","2026-06-08","2026-06-14","2026-06-15"], description:"Bright studio loft with exposed brick, king bed, full kitchen, and fast WiFi. Walking distance to shops and restaurants. Perfect for weekend getaways.", amenities:["King bed","Full kitchen","Fast WiFi","Smart TV","Washer/Dryer","Self check-in","Coffee maker"], capacity:2, photos:["🏢","🛋️","-","🛁"], bedrooms:1, bathrooms:1, sqft:650, uploadedImages:[] },
  { id:21, title:"Sunny 2BR Townhouse",       ownerId:"james",  ownerAvatar:"👨🏿", owner:"James O.",    distance:0.7, price:130, priceUnit:"night", category:"housing", emoji:"🏡", color:"#F59E0B", available:true,  rating:4.8, reviews:61, lat:40.7150, lng:-74.0070, booked:["2026-06-10","2026-06-11","2026-06-12","2026-06-20","2026-06-21"], description:"Spacious 2BR townhouse with a private patio, modern kitchen, and 2 full baths. Great for small families or couples. Pet-friendly.", amenities:["2 Bedrooms","2 Bathrooms","Private patio","Pet friendly","Parking included","Full kitchen","Laundry"], capacity:4, photos:["🏡","🛏️","🌿","🐕"], bedrooms:2, bathrooms:2, sqft:1100, uploadedImages:[] },
  { id:22, title:"Modern Loft - City Views",  ownerId:"mei",    ownerAvatar:"👩🏻", owner:"Mei L.",      distance:1.1, price:110, priceUnit:"night", category:"housing", emoji:"🌆", color:"#06B6D4", available:true,  rating:4.7, reviews:28, lat:40.7162, lng:-74.0042, booked:["2026-06-13","2026-06-14","2026-06-27","2026-06-28"], description:"Sleek open-plan loft with floor-to-ceiling windows, city views, and rooftop terrace access. Ideal for creatives and professionals.", amenities:["City views","Rooftop access","Designer furniture","Office desk","Fast WiFi","Smart home","Gym access"], capacity:2, photos:["🌆","🛋️","🌃","🏙️"], bedrooms:1, bathrooms:1, sqft:800, uploadedImages:[] },
  { id:23, title:"Farmhouse Suite (3BR)",     ownerId:"davis",  ownerAvatar:"👨🏾", owner:"Davis Ranch", distance:6.1, price:220, priceUnit:"night", category:"housing", emoji:"🏚️", color:"#7C3AED", available:true,  rating:5.0, reviews:17, lat:40.7210, lng:-74.0140, booked:["2026-06-06","2026-06-07","2026-06-13","2026-06-14"], description:"Private 3BR suite inside a working farmhouse. Stone fireplace, wraparound porch, 6 acres of land. Farm breakfast on request.", amenities:["3 Bedrooms","2 Baths","Stone fireplace","Farm breakfast +$20","6 acres","Fire pit","Parking"], capacity:6, photos:["🏚️","🔥","🌾","🥂"], bedrooms:3, bathrooms:2, sqft:1800, uploadedImages:[] },
  { id:24, title:"Lakeside Cabin Rental",     ownerId:"nguyen", ownerAvatar:"👩🏽", owner:"Nguyen Fam.", distance:8.3, price:175, priceUnit:"night", category:"housing", emoji:"🏕️", color:"#0369A1", available:true,  rating:4.9, reviews:44, lat:40.7220, lng:-74.0160, booked:["2026-06-05","2026-06-06","2026-06-12","2026-06-13"], description:"Lakefront cabin with private dock. Kayaks, paddleboards, and fishing gear included. Stunning sunset views. Sleeps 6.", amenities:["Sleeps 6","Private dock","Kayaks incl.","Fishing gear","Fire pit","BBQ grill","WiFi"], capacity:6, photos:["🏕️","🌊","🌅","🛶"], bedrooms:2, bathrooms:1, sqft:950, uploadedImages:[] },
];

// ---------------------------------------------------------------
// DATA
// ---------------------------------------------------------------

const ALL_CATEGORIES = [
  { id:"all",          label:"All",          emoji:"-" },
  { id:"tools",        label:"Tools",        emoji:"🔧" },
  { id:"trailers",     label:"Trailers",     emoji:"🚛" },
  { id:"construction", label:"Equipment",    emoji:"🏗️" },
  { id:"kitchen",      label:"Kitchen",      emoji:"🍳" },
  { id:"garden",       label:"Garden",       emoji:"🌱" },
  { id:"outdoors",     label:"Outdoors",     emoji:"🏕️" },
  { id:"venues",       label:"Venues",       emoji:"🏛️" },
  { id:"party",        label:"Party",        emoji:"🎉" },
  { id:"tech",         label:"Tech",         emoji:"💻" },
  { id:"housing",      label:"Housing",      emoji:"🏠" },
  { id:"vehicles",     label:"Vehicles",     emoji:"🚗" },
];

const SEED_ITEMS = [
  { id:1,ownerId:"marcus",   title:"Power Drill",         owner:"Marcus T.",  ownerAvatar:"👨🏾", distance:0.3, price:8,    priceUnit:"day",   category:"tools",    emoji:"🔧", color:"#FF6B35", available:true,  rating:4.9, reviews:34, lat:40.7138, lng:-74.0062, booked:["2026-06-04","2026-06-05"], description:"Cordless 20V with 2 batteries. Perfect for home projects.", amenities:[], capacity:null, photos:["🔧","-️","🪛"] },
  { id:2,ownerId:"priya",   title:"Stand Mixer",         owner:"Priya S.",   ownerAvatar:"👩🏽", distance:0.6, price:15,   priceUnit:"day",   category:"kitchen",  emoji:"🥣", color:"#4ECDC4", available:true,  rating:4.8, reviews:21, lat:40.7148, lng:-74.0080, booked:["2026-06-07"],             description:"KitchenAid 5qt. Dough hook, whisk, and paddle included.", amenities:[], capacity:null, photos:["🥣","🍰","🎂"] },
  { id:3,ownerId:"jake",   title:"Pressure Washer",     owner:"Jake L.",    ownerAvatar:"👨🏼", distance:0.9, price:25,   priceUnit:"day",   category:"garden",   emoji:"💦", color:"#45B7D1", available:true,  rating:5.0, reviews:12, lat:40.7125, lng:-74.0045, booked:[],                         description:"2000 PSI electric. Hose and surface cleaner included.", amenities:[], capacity:null, photos:["💦","🏡","🌿"] },
  { id:4,ownerId:"sofia",   title:"4-Person Tent",       owner:"Sofia R.",   ownerAvatar:"👩🏻", distance:1.1, price:20,   priceUnit:"day",   category:"outdoors", emoji:"-", color:"#96CEB4", available:false, rating:4.7, reviews:18, lat:40.7160, lng:-74.0090, booked:["2026-06-02","2026-06-03","2026-06-04","2026-06-05","2026-06-06"], description:"REI Co-op 4-person. Stakes and rainfly included.", amenities:[], capacity:4, photos:["-","🌲","🌙"] },
  { id:5,ownerId:"carl",   title:"8ft Ladder",          owner:"Carl M.",    ownerAvatar:"👨🏻", distance:0.5, price:10,   priceUnit:"day",   category:"tools",    emoji:"🪜", color:"#FBBF24", available:true,  rating:4.6, reviews:29, lat:40.7132, lng:-74.0055, booked:[],                         description:"Aluminum step ladder, 225lb capacity.", amenities:[], capacity:null, photos:["🪜","🏠","🔨"] },
  { id:6,ownerId:"linda",   title:"Air Fryer (6qt)",     owner:"Linda K.",   ownerAvatar:"👩🏿", distance:0.8, price:12,   priceUnit:"day",   category:"kitchen",  emoji:"🍟", color:"#DDA0DD", available:true,  rating:4.9, reviews:41, lat:40.7145, lng:-74.0070, booked:["2026-06-08","2026-06-09"], description:"6qt Ninja. Great for large batches.", amenities:[], capacity:null, photos:["🍟","🍗","🥦"] },
  { id:7,ownerId:"tom",   title:"Kayak + Paddle",      owner:"Tom B.",     ownerAvatar:"👨🏽", distance:2.1, price:40,   priceUnit:"day",   category:"outdoors", emoji:"🛶", color:"#FF8C69", available:true,  rating:4.8, reviews:9,  lat:40.7180, lng:-74.0100, booked:[],                         description:"Single sit-in kayak with paddle and life jacket.", amenities:[], capacity:1, photos:["🛶","🌊","🏞️"] },
  { id:8,ownerId:"grace",   title:"Lawn Mower",          owner:"Grace Y.",   ownerAvatar:"👩🏼", distance:0.4, price:18,   priceUnit:"day",   category:"garden",   emoji:"🌿", color:"#77DD77", available:true,  rating:4.7, reviews:16, lat:40.7135, lng:-74.0048, booked:["2026-06-03"],             description:"Self-propelled gas mower. Bag and mulch options.", amenities:[], capacity:null, photos:["🌿","🏡","🌻"] },
  { id:9,ownerId:"derek",   title:"Cargo Van",           owner:"Derek F.",   ownerAvatar:"👨🏾", distance:1.4, price:65,   priceUnit:"day",   category:"vehicles", emoji:"🚐", color:"#6C63FF", available:true,  rating:4.9, reviews:27, lat:40.7170, lng:-74.0030, booked:["2026-06-10"],             description:"2022 Ford Transit 250. Clean, insured, 1000lb payload.", amenities:["Insurance included","Fuel not included","Must have valid license"], capacity:null, photos:["🚐","📦","🛣️"] },
  { id:10,ownerId:"yuki",  title:"DJI Drone",           owner:"Yuki T.",    ownerAvatar:"👩🏻", distance:0.7, price:45,   priceUnit:"day",   category:"tech",     emoji:"🚁", color:"#38BDF8", available:true,  rating:5.0, reviews:8,  lat:40.7142, lng:-74.0058, booked:["2026-06-06"],             description:"DJI Mini 3 Pro. 4K video, 3 batteries, case included.", amenities:["Includes case","FAA registered","Tutorial available"], capacity:null, photos:["🚁","📸","🌅"] },
  { id:11,ownerId:"rosa",  title:"Party Tent (20x30)", owner:"Rosa M.",    ownerAvatar:"👩🏽", distance:1.8, price:80,   priceUnit:"day",   category:"party",    emoji:"🎪", color:"#F472B6", available:true,  rating:4.8, reviews:14, lat:40.7155, lng:-74.0075, booked:[],                         description:"20x30ft frame tent. Seats 40-50 guests. Setup/teardown extra.", amenities:["Seats 50","Setup available (+$50)","Sidewalls included"], capacity:50, photos:["🎪","🎊","-"] },
  { id:12, title:"Folding Tables (10)", owner:"Rosa M.",   ownerAvatar:"👩🏽", distance:1.8, price:30,   priceUnit:"day",   category:"party",    emoji:"🪑", color:"#FB923C", available:true,  rating:4.8, reviews:14, lat:40.7155, lng:-74.0075, booked:[],                         description:"10 x 6ft folding tables + 80 chairs. Delivery available.", amenities:["80 chairs included","Delivery available (+$25)"], capacity:80, photos:["🪑","🎊","🍽️"] },
  // VENUES
  { id:13,ownerId:"millers",  title:"Countryside Barn",    owner:"The Millers", ownerAvatar:"👨🏻", distance:4.2, price:350, priceUnit:"day",   category:"venues",   emoji:"🏚️", color:"#92400E", available:true,  rating:4.9, reviews:62, lat:40.7200, lng:-74.0120, booked:["2026-06-14","2026-06-15","2026-06-21","2026-06-22","2026-06-28"], description:"Stunning 200-year-old restored barn. Rustic exposed beams, string lights, and a wrap-around porch. Perfect for weddings, corporate retreats, and milestone celebrations.", amenities:["Seats 150","Full kitchen","Bridal suite","Parking for 60 cars","Outdoor ceremony space","Tables & chairs included","On-site caretaker"], capacity:150, photos:["🏚️","🌾","-","🌅"] },
  { id:14,ownerId:"chen",  title:"Garden Pavilion",     owner:"Chen Family", ownerAvatar:"👩🏻", distance:2.8, price:180, priceUnit:"day",   category:"venues",   emoji:"🏛️", color:"#065F46", available:true,  rating:4.7, reviews:38, lat:40.7185, lng:-74.0085, booked:["2026-06-07","2026-06-20","2026-06-27"], description:"Elegant garden pavilion surrounded by manicured grounds and a koi pond. Ideal for outdoor weddings, baby showers, garden parties, and photo shoots.", amenities:["Seats 80","String lights","Outdoor kitchen","Fire pit","Restrooms on site","Parking for 30"], capacity:80, photos:["🏛️","🌺","🌿","🌊"] },
  { id:15,ownerId:"jay",  title:"Rooftop Terrace",     owner:"Jay Park",    ownerAvatar:"👨🏽", distance:1.1, price:250, priceUnit:"day",   category:"venues",   emoji:"🌆", color:"#1E3A5F", available:true,  rating:4.8, reviews:29, lat:40.7165, lng:-74.0040, booked:["2026-06-13","2026-06-20"], description:"NYC-view rooftop with 3,000 sq ft of open space. Indoor/outdoor with retractable awning. Great for cocktail parties, birthday bashes, and product launches.", amenities:["Seats 100 standing","Retractable awning","Bar cart included","City views","AV system","Elevator access"], capacity:100, photos:["🌆","🍾","🌃","🎉"] },
  { id:16,ownerId:"davis",  title:"Farmhouse Hall",      owner:"Davis Ranch", ownerAvatar:"👨🏾", distance:6.1, price:280, priceUnit:"day",   category:"venues",   emoji:"🏡", color:"#7C3AED", available:true,  rating:5.0, reviews:17, lat:40.7210, lng:-74.0140, booked:["2026-06-06","2026-06-13"], description:"Spacious farmhouse great hall with original hardwood floors and stone fireplace. Sleeps up to 20 on-site. Perfect for weekend retreats and family reunions.", amenities:["Seats 120","Sleeps 20","Stone fireplace","Commercial kitchen","6 acres of land","Bonfire pit","Free parking"], capacity:120, photos:["🏡","🔥","🌙","🥂"] },
  { id:17,ownerId:"nguyen",  title:"Lakeside Cabin",      owner:"Nguyen Fam.", ownerAvatar:"👩🏽", distance:8.3, price:200, priceUnit:"day",   category:"venues",   emoji:"🏕️", color:"#0369A1", available:true,  rating:4.9, reviews:44, lat:40.7220, lng:-74.0160, booked:["2026-06-05","2026-06-06","2026-06-12","2026-06-13"], description:"Lakefront cabin with private dock and fire pit. Perfect for small retreats, bachelorette weekends, or family gatherings.", amenities:["Sleeps 12","Private dock","Fire pit","Kayaks included","BBQ grill","Fishing allowed"], capacity:40, photos:["🏕️","🏊","🌲","🌊"] },
  // -- TRAILERS ------------------------------------------------------------------
  { id:30, ownerId:"derek", title:"16ft Utility Trailer",   owner:"Derek F.",   ownerAvatar:"👨🏾", distance:1.4, price:55,  priceUnit:"day", category:"trailers",     emoji:"🚛", color:"#6C63FF", available:true,  rating:4.9, reviews:21, lat:40.7170, lng:-74.0030, booked:["2026-06-10"], description:"16ft open utility trailer with ramps. Rated for 7,000 lbs. Perfect for hauling ATVs, furniture, or equipment. Ball hitch 2-5/16.", amenities:["Ramps included","7,000 lb capacity","Tie-down rings","Ball hitch 2-5/16"], capacity:null, photos:["🚛","📦","🛣️"] },
  { id:31, ownerId:"carl",  title:"Enclosed Cargo Trailer", owner:"Carl M.",    ownerAvatar:"👨🏻", distance:0.5, price:75,  priceUnit:"day", category:"trailers",     emoji:"📦", color:"#374151", available:true,  rating:4.7, reviews:14, lat:40.7132, lng:-74.0055, booked:[], description:"7x14 enclosed trailer with side door and rear ramp. Weatherproof. Great for moving or securing tools overnight.", amenities:["Side door","Rear ramp","Interior lighting","Lockable"], capacity:null, photos:["📦","🚛","🔒"] },
  { id:32, ownerId:"jake",  title:"Dump Trailer (10ft)",    owner:"Jake L.",    ownerAvatar:"👨🏼", distance:0.9, price:90,  priceUnit:"day", category:"trailers",     emoji:"🪣", color:"#D97706", available:true,  rating:4.8, reviews:9,  lat:40.7125, lng:-74.0045, booked:["2026-06-08"], description:"10ft hydraulic dump trailer. 12,000 lb capacity. Ideal for landscaping, demolition debris, or bulk materials.", amenities:["Hydraulic dump","12,000 lb capacity","Tarp included","2-5/16 hitch"], capacity:null, photos:["🪣","🏗️","🌿"] },
  { id:33, ownerId:"grace", title:"Car Hauler Trailer",     owner:"Grace Y.",   ownerAvatar:"👩🏼", distance:0.4, price:85,  priceUnit:"day", category:"trailers",     emoji:"🚗", color:"#0EA5E9", available:true,  rating:4.6, reviews:7,  lat:40.7135, lng:-74.0048, booked:[], description:"18ft car hauler with electric brakes and tie-down straps. Holds up to 2 cars. Great for vehicle transport or track days.", amenities:["Electric brakes","Tie-down straps","18ft deck","2-car capacity"], capacity:null, photos:["🚗","🛣️","🔧"] },
  // -- CONSTRUCTION EQUIPMENT ----------------------------------------------------
  { id:40, ownerId:"derek", title:"Mini Excavator",         owner:"Derek F.",   ownerAvatar:"👨🏾", distance:1.4, price:280, priceUnit:"day", category:"construction", emoji:"🦺", color:"#F59E0B", available:true,  rating:4.9, reviews:16, lat:40.7170, lng:-74.0030, booked:["2026-06-14","2026-06-15"], description:"1.5-ton mini excavator with 2 buckets. Perfect for landscaping, trenching, and small demolition. Trailer delivery available.", amenities:["2 buckets included","Delivery available +$75","Fuel not included","License not required"], capacity:null, photos:["🦺","🏗️","-️"] },
  { id:41, ownerId:"carl",  title:"Skid Steer Loader",      owner:"Carl M.",    ownerAvatar:"👨🏻", distance:0.5, price:320, priceUnit:"day", category:"construction", emoji:"🏗️", color:"#EF4444", available:true,  rating:4.7, reviews:11, lat:40.7132, lng:-74.0055, booked:[], description:"Bobcat S550 skid steer with bucket and pallet forks. 1,850 lb lift capacity. Great for grading, moving materials, and site work.", amenities:["Bucket + forks included","1,850 lb capacity","Delivery available","Fuel not included"], capacity:null, photos:["🏗️","-️","🦺"] },
  { id:42, ownerId:"jake",  title:"Plate Compactor",        owner:"Jake L.",    ownerAvatar:"👨🏼", distance:0.9, price:65,  priceUnit:"day", category:"construction", emoji:"-️", color:"#6B7280", available:true,  rating:4.8, reviews:19, lat:40.7125, lng:-74.0045, booked:["2026-06-06"], description:"Honda-powered plate compactor. 13,000 lb centrifugal force. Essential for compacting gravel, sand, and soil before paving.", amenities:["Honda engine","Water tank for asphalt","Easy transport"], capacity:null, photos:["-️","🏗️","🛤️"] },
  { id:43, ownerId:"marcus",title:"Concrete Mixer (3.5 cu ft)",owner:"Marcus T.",ownerAvatar:"👨🏾",distance:0.3, price:45,  priceUnit:"day", category:"construction", emoji:"🔄", color:"#9CA3AF", available:true,  rating:4.6, reviews:8,  lat:40.7138, lng:-74.0062, booked:[], description:"Electric concrete mixer. 3.5 cubic foot drum. Great for footings, posts, and small slabs. Extension cord included.", amenities:["Electric powered","Extension cord incl.","Easy to clean"], capacity:null, photos:["🔄","🏗️","-️"] },
  { id:44, ownerId:"carl",  title:"Generator (8000W)",      owner:"Carl M.",    ownerAvatar:"👨🏻", distance:0.5, price:70,  priceUnit:"day", category:"construction", emoji:"-", color:"#FCD34D", available:true,  rating:4.9, reviews:23, lat:40.7132, lng:-74.0055, booked:["2026-06-09","2026-06-10"], description:"8,000W dual-fuel generator. Runs on gas or propane. Powers most jobsite tools. Perfect for construction, events, or outages.", amenities:["Dual fuel (gas/propane)","8,000W output","4 outlets","Fuel not included"], capacity:null, photos:["-","🔌","🏗️"] },
];

const SEED_MY_LISTINGS = [
  { id:101, title:"Shop Vac",   price:9,   priceUnit:"day", category:"tools",  emoji:"🧹", color:"#F59E0B", available:true,  description:"16 gallon wet/dry shop vac with full set of attachments.", booked:["2026-06-05","2026-06-06"], views:47, requests:3, earnings:63,  rating:4.8, reviews:7,  amenities:[], capacity:null, photos:["🧹","💨","-️"], uploadedImages:[] },
  { id:102, title:"Fondue Set", price:11,  priceUnit:"day", category:"kitchen",emoji:"🫕", color:"#EC4899", available:false, description:"8-person electric fondue set with chocolate & cheese forks.", booked:["2026-06-14","2026-06-15"], views:23, requests:1, earnings:22,  rating:5.0, reviews:2,  amenities:[], capacity:null, photos:["🫕","🧀","🍫"] },
  { id:103, title:"Backyard Pavilion", price:120, priceUnit:"day", category:"venues", emoji:"-️", color:"#10B981", available:true, description:"Covered 16x20 ft backyard pavilion with string lights. Great for small parties and gatherings.", booked:["2026-06-07","2026-06-08"], views:89, requests:7, earnings:360, rating:4.9, reviews:12, amenities:["Seats 30","String lights","Picnic tables","BBQ grill","Restroom access"], capacity:30, photos:["-️","🌿","-"] },
];

const SEED_MESSAGES = [
  { id:1, from:"Marcus T.", avatar:"👨🏾", item:"Power Drill",   time:"10 min ago", unread:true,  thread:[
    { mine:false, text:"Hi! Is the drill available this Saturday?", time:"10:42 AM" },
    { mine:true,  text:"Yes it's free! Just bring it back by Sunday evening.", time:"10:45 AM" },
    { mine:false, text:"Perfect, I'll pick it up around 9am?", time:"10:48 AM" },
  ]},
  { id:2, from:"Priya S.",  avatar:"👩🏽", item:"Stand Mixer",    time:"1 hr ago",   unread:false, thread:[
    { mine:false, text:"Would you do $12/day instead of $15?", time:"9:30 AM" },
    { mine:true,  text:"Best I can do is $13 - deal?", time:"9:35 AM" },
    { mine:false, text:"Deal! I'll take June 10-12.", time:"9:40 AM" },
  ]},
  { id:3, from:"Tom B.",    avatar:"👨🏽", item:"Shop Vac",       time:"Yesterday",  unread:false, thread:[
    { mine:false, text:"Just dropped it back off - works great!", time:"Yesterday 6pm" },
    { mine:true,  text:"Thanks Tom! Glad it helped 🙌", time:"Yesterday 6:10pm" },
  ]},
  { id:4, from:"The Millers",avatar:"👨🏻",item:"Countryside Barn",time:"2 days ago", unread:true, thread:[
    { mine:false, text:"Hi! We're interested in the barn for our wedding on Aug 22nd. Is it available?", time:"Monday 2pm" },
    { mine:true,  text:"Let me check the calendar and get back to you!", time:"Monday 2:30pm" },
  ]},
];

const NOTIFICATION_SEED = [
  { id:1, icon:"📩", text:"Marcus T. wants to rent your Power Drill", sub:"Jun 7 · $8/day", time:"10 min ago", unread:true, type:"request" },
  { id:2, icon:"-", text:"Priya S. left you a 5-star review", sub:"Stand Mixer rental", time:"1 hr ago", unread:true, type:"review" },
  { id:3, icon:"💰", text:"Payment received - $24.00", sub:"Shop Vac · 3 days", time:"Yesterday", unread:false, type:"payment" },
  { id:4, icon:"📅", text:"Reminder: Kayak rental ends tomorrow", sub:"Tom B. · Return by 6pm", time:"Yesterday", unread:false, type:"reminder" },
  { id:5, icon:"-", text:"Your booking was confirmed!", sub:"Countryside Barn · Aug 22-23", time:"2 days ago", unread:false, type:"confirm" },
];

// ---------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------


// Helper functions
function getDatesInRange(start, end) {
  if (!start || !end) return [];
  const dates = [];
  const d = new Date(start);
  const e = new Date(end);
  while (d <= e) {
    dates.push(d.toISOString().slice(0,10));
    d.setDate(d.getDate()+1);
  }
  return dates;
}
function daysBetween(a, b) {
  if (!a) return 1;
  const d1 = new Date(a), d2 = new Date(b || a);
  return Math.max(1, Math.round((d2-d1)/(1000*60*60*24))+1);
}
function formatDate(d) {
  if (!d) return '';
  const dt = new Date(d+'T00:00:00');
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return months[dt.getMonth()] + ' ' + dt.getDate();
}

// Toast
function Toast({ toast }) {
  if (!toast) return null;
  return (
    <div style={{ position:"fixed", top:20, left:"50%", transform:"translateX(-50%)", background: toast.type==="error"?"#FA3E3E":"#00B894", color:"#fff", borderRadius:12, padding:"11px 20px", fontSize:13, fontWeight:700, zIndex:9999, boxShadow:"0 4px 20px rgba(0,0,0,0.2)", whiteSpace:"nowrap" }}>
      {toast.msg}
    </div>
  );
}

// StarRow
function StarRow({ rating, count, size=13 }) {
  if (!rating) return null;
  return (
    <div style={{ display:"flex", alignItems:"center", gap:3 }}>
      {[1,2,3,4,5].map(s => <span key={s} style={{ color:s<=Math.round(rating)?"#F5A623":"#CDD0D4", fontSize:size }}>&#9733;</span>)}
      <span style={{ fontSize:size, color:"#65676B" }}>{rating} ({count})</span>
    </div>
  );
}

// RangeCalendar
function RangeCalendar({ booked=[], startDate, endDate, onRangeChange }) {
  const today = new Date(2026, 5, 2);
  const [month, setMonth] = useState(today.getMonth());
  const [year, setYear] = useState(today.getFullYear());
  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const DAYS = ["Su","Mo","Tu","We","Th","Fr","Sa"];
  const dim = new Date(year, month+1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();
  const cells = [];
  for (let i=0; i<firstDay; i++) cells.push(null);
  for (let d=1; d<=dim; d++) cells.push(d);
  const pad = n => String(n).padStart(2,"0");
  const toKey = d => year + "-" + pad(month+1) + "-" + pad(d);
  const isPast = d => new Date(year, month, d) < today;
  const isBooked = d => booked.includes(toKey(d));
  const isStart = d => toKey(d) === startDate;
  const isEnd = d => toKey(d) === endDate;
  const inRange = d => {
    if (!startDate || !endDate) return false;
    const k = toKey(d);
    return k > startDate && k < endDate;
  };
  const handleDay = (e, d) => {
    e.preventDefault();
    e.stopPropagation();
    if (isPast(d) || isBooked(d)) return;
    const scrollEl = e.currentTarget.closest('[style*="overflow"]');
    const savedTop = scrollEl ? scrollEl.scrollTop : 0;
    const k = toKey(d);
    if (!startDate || (startDate && endDate)) {
      onRangeChange(k, null);
    } else {
      if (k < startDate) onRangeChange(k, startDate);
      else onRangeChange(startDate, k);
    }
    if (scrollEl) requestAnimationFrame(() => { scrollEl.scrollTop = savedTop; });
  };
  return (
    <div style={{ background:"#F7F8FA", borderRadius:14, padding:14, border:"1px solid #E4E6EB", marginBottom:14 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
        <button onMouseDown={e=>e.preventDefault()} onClick={()=>{ if(month===0){setMonth(11);setYear(y=>y-1);}else setMonth(m=>m-1); }} style={{ background:"#E4E6EB", border:"none", borderRadius:8, width:32, height:32, cursor:"pointer", fontSize:16 }}>&#8249;</button>
        <div style={{ fontWeight:700, fontSize:14, color:"#1C1E21" }}>{MONTHS[month]} {year}</div>
        <button onMouseDown={e=>e.preventDefault()} onClick={()=>{ if(month===11){setMonth(0);setYear(y=>y+1);}else setMonth(m=>m+1); }} style={{ background:"#E4E6EB", border:"none", borderRadius:8, width:32, height:32, cursor:"pointer", fontSize:16 }}>&#8250;</button>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:2, textAlign:"center" }}>
        {DAYS.map(d => <div key={d} style={{ fontSize:10, color:"#8A8D91", fontWeight:700, paddingBottom:6 }}>{d}</div>)}
        {cells.map((d,i) => {
          if (!d) return <div key={i} />;
          const past=isPast(d), bkd=isBooked(d), s=isStart(d), en=isEnd(d), rng=inRange(d);
          return (
            <div key={i} onMouseDown={e=>e.preventDefault()} onClick={e=>handleDay(e,d)}
              style={{ borderRadius: s?"8px 0 0 8px": en?"0 8px 8px 0": rng?"0":"8px", padding:"8px 2px", fontSize:13, fontWeight:(s||en)?700:500, cursor:past||bkd?"not-allowed":"pointer", background: s||en?"#00B894": rng?"#E8FBF6": bkd?"#FFEBEE":"transparent", color: s||en?"#fff": bkd?"#FA3E3E": past?"#CDD0D4":"#1C1E21", opacity:past?0.4:1, userSelect:"none" }}>
              {d}
            </div>
          );
        })}
      </div>
      <div style={{ display:"flex", gap:14, marginTop:12, fontSize:11 }}>
        <div style={{ display:"flex", alignItems:"center", gap:5 }}><div style={{ width:12, height:12, borderRadius:3, background:"#00B894" }}/><span style={{ color:"#65676B" }}>Selected</span></div>
        <div style={{ display:"flex", alignItems:"center", gap:5 }}><div style={{ width:12, height:12, borderRadius:3, background:"#E8FBF6", border:"1px solid #B2EFE3" }}/><span style={{ color:"#65676B" }}>Range</span></div>
        <div style={{ display:"flex", alignItems:"center", gap:5 }}><div style={{ width:12, height:12, borderRadius:3, background:"#FFEBEE", border:"1px solid #FFCDD2" }}/><span style={{ color:"#65676B" }}>Booked</span></div>
      </div>
    </div>
  );
}

// PaymentBreakdown
function PaymentBreakdown({ price, priceUnit, nights }) {
  if (!nights || nights < 1) return null;
  const sub = price * nights;
  const fee = Math.round(sub * 0.12);
  return (
    <div style={{ background:"#F7F8FA", borderRadius:12, padding:"12px 14px", marginBottom:14, border:"1px solid #E4E6EB", fontSize:13 }}>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6, color:"#65676B" }}>
        <span>${price} x {nights} {priceUnit || "day"}{nights>1?"s":""}</span>
        <span>${sub}</span>
      </div>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8, color:"#65676B" }}>
        <span>Service fee (12%)</span><span>${fee}</span>
      </div>
      <div style={{ display:"flex", justifyContent:"space-between", fontWeight:800, fontSize:15, borderTop:"1px solid #E4E6EB", paddingTop:8 }}>
        <span>Total</span><span style={{ color:"#00B894" }}>${sub+fee}</span>
      </div>
    </div>
  );
}

// PhotoBrowserModal
function PhotoBrowserModal({ data, onClose }) {
  const [idx, setIdx] = useState(data ? (data.startIdx || 0) : 0);
  if (!data) return null;
  const all = [...(data.uploadedImages||[]).map(i=>({ t:"img", s:i.url })), ...(data.photos||[]).map(p=>({ t:"emoji", s:p }))];
  if (!all.length) return null;
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.92)", zIndex:900, display:"flex", alignItems:"center", justifyContent:"center" }} onClick={onClose}>
      <div style={{ background:"#fff", borderRadius:16, overflow:"hidden", border:"1px solid #E4E6EB", maxWidth:380, width:"92%" }} onClick={e=>e.stopPropagation()}>
        <div style={{ height:280, display:"flex", alignItems:"center", justifyContent:"center", background:"#F0F2F5", position:"relative" }}>
          {all[idx].t==="img"
            ? <img src={all[idx].s} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }}/>
            : <span style={{ fontSize:80 }}>{all[idx].s}</span>}
          {all.length > 1 && (
            <div style={{ position:"absolute", bottom:10, left:0, right:0, display:"flex", justifyContent:"center", gap:6 }}>
              {all.map((_,i) => <div key={i} onClick={e=>{e.stopPropagation();setIdx(i);}} style={{ width:i===idx?20:8, height:8, borderRadius:4, background:i===idx?"#00B894":"rgba(255,255,255,0.6)", cursor:"pointer", transition:"all 0.2s" }}/>)}
            </div>
          )}
        </div>
        <div style={{ display:"flex", justifyContent:"space-between", padding:"10px 16px" }}>
          <button onClick={e=>{e.stopPropagation();setIdx(i=>Math.max(0,i-1));}} style={{ background:"#F0F2F5", border:"none", borderRadius:8, padding:"8px 16px", cursor:"pointer", fontWeight:700, color:"#1C1E21" }} disabled={idx===0}>&larr;</button>
          <span style={{ fontSize:12, color:"#65676B", alignSelf:"center" }}>{idx+1} / {all.length}</span>
          <button onClick={e=>{e.stopPropagation();setIdx(i=>Math.min(all.length-1,i+1));}} style={{ background:"#F0F2F5", border:"none", borderRadius:8, padding:"8px 16px", cursor:"pointer", fontWeight:700, color:"#1C1E21" }} disabled={idx===all.length-1}>&rarr;</button>
        </div>
      </div>
    </div>
  );
}

// OwnerProfileModal
function OwnerProfileModal({ ownerId, allItems, onClose, onSelectItem, onMessage }) {
  if (!ownerId) return null;
  const owner = OWNERS[ownerId];
  if (!owner) return null;
  const owned = allItems.filter(i => i.ownerId === ownerId);
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", zIndex:700, display:"flex", alignItems:"flex-end" }} onClick={onClose}>
      <div style={{ background:"#fff", borderRadius:"16px 16px 0 0", padding:"20px 16px 40px", width:"100%", maxHeight:"90dvh", overflowY:"auto", borderTop:"1px solid #E4E6EB" }} onClick={e=>e.stopPropagation()}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
          <button onClick={onClose} style={{ background:"#F0F2F5", border:"none", borderRadius:10, width:34, height:34, cursor:"pointer", fontSize:18, color:"#65676B" }}>&larr;</button>
          <div style={{ fontSize:14, fontWeight:700, color:"#65676B" }}>Owner Profile</div>
          <div style={{ width:34 }}/>
        </div>
        <div style={{ textAlign:"center", marginBottom:20 }}>
          <div style={{ fontSize:60, marginBottom:8 }}>{owner.avatar}</div>
          <div style={{ fontSize:20, fontWeight:800, color:"#1C1E21" }}>{owner.name}</div>
          <div style={{ fontSize:12, color:"#65676B", marginBottom:6 }}>Member since {owner.joined}</div>
          <StarRow rating={owner.rating} count={owner.reviews} size={14}/>
          <div style={{ display:"flex", gap:6, justifyContent:"center", marginTop:10 }}>
            {owner.verified && <div style={{ background:"#E9F5E9", borderRadius:20, padding:"4px 10px", fontSize:11, color:"#31A24C", fontWeight:700 }}>Verified</div>}
            {owner.superhost && <div style={{ background:"#FFF8E1", borderRadius:20, padding:"4px 10px", fontSize:11, color:"#E87722", fontWeight:700 }}>Superhost</div>}
          </div>
        </div>
        <div style={{ background:"#F7F8FA", borderRadius:12, padding:"12px 14px", marginBottom:16, border:"1px solid #E4E6EB" }}>
          <div style={{ fontWeight:700, fontSize:13, marginBottom:6, color:"#1C1E21" }}>About</div>
          <div style={{ fontSize:13, color:"#65676B", lineHeight:1.6 }}>{owner.bio}</div>
        </div>
        <div style={{ fontWeight:700, fontSize:14, marginBottom:10, color:"#1C1E21" }}>{owner.name.split(" ")[0]}&#39;s Listings ({owned.length})</div>
        {owned.length === 0 && <div style={{ textAlign:"center", padding:20, color:"#65676B" }}>No listings</div>}
        {owned.map(item => (
          <div key={item.id} onClick={()=>{ onSelectItem(item); onClose(); }} style={{ display:"flex", gap:12, background:"#fff", borderRadius:12, border:"1px solid #E4E6EB", padding:"12px 14px", marginBottom:10, cursor:"pointer", alignItems:"center" }}>
            <div style={{ fontSize:28, minWidth:48, textAlign:"center", background:(item.color||"#eee")+"15", borderRadius:10, padding:"8px 0" }}>{item.emoji}</div>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:600, fontSize:13, color:"#1C1E21" }}>{item.title}</div>
              <div style={{ fontSize:11, color:"#65676B" }}>{item.category} &middot; {item.distance}mi</div>
            </div>
            <div style={{ textAlign:"right" }}>
              <div style={{ fontSize:14, fontWeight:700, color:"#1C1E21" }}>${item.price}</div>
              <div style={{ fontSize:10, color:"#65676B" }}>/{item.priceUnit||"day"}</div>
            </div>
          </div>
        ))}
        <button onClick={()=>onMessage(owner)} style={{ width:"100%", padding:"14px", borderRadius:8, border:"none", fontFamily:"inherit", fontWeight:700, fontSize:15, cursor:"pointer", background:"#00B894", color:"#fff", marginTop:10 }}>
          Message {owner.name.split(" ")[0]}
        </button>
        <button onClick={onClose} style={{ width:"100%", padding:"12px", borderRadius:8, border:"1px solid #CDD0D4", fontFamily:"inherit", fontWeight:600, fontSize:14, cursor:"pointer", background:"#fff", color:"#1C1E21", marginTop:8 }}>Close</button>
      </div>
    </div>
  );
}

// ItemDetailSheet - top-level component so hooks work correctly
function ItemDetailSheet({ item, requestSent, favorites, toggleFav, allItems, OWNERS, setOwnerProfileId, setPhotoBrowser, onDismiss, setPaymentModal, setPaymentStep, onConfirmBooking }) {
  const C = { muted:"#65676B", faint:"#8A8D91" };
  const CAT_MAP = { tools:"Tools", trailers:"Trailers", construction:"Equipment", kitchen:"Kitchen", garden:"Garden", outdoors:"Outdoors", venues:"Venues", party:"Party", vehicles:"Vehicles", tech:"Tech", housing:"Housing" };
  const sheetRef = useRef(null);
  const [dragY, setDragY] = useState(0);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [startDate, setStartDate] = useState(null);
  const [endDate, setEndDate] = useState(null);

  useEffect(() => {
    setStartDate(null);
    setEndDate(null);
    setDragY(0);
    setDragX(0);
    setDragging(false);
  }, [item && item.id]);

  useEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    let sx=0, sy=0, sTop=0;
    const onStart = e => { sx=e.touches[0].clientX; sy=e.touches[0].clientY; sTop=el.scrollTop||0; setDragging(false); };
    const onMove = e => {
      const dy=e.touches[0].clientY-sy, dx=e.touches[0].clientX-sx;
      const atTop=sTop<=2;
      const goDown=atTop&&dy>8&&Math.abs(dy)>Math.abs(dx)*1.2;
      const goRight=dx>8&&Math.abs(dx)>Math.abs(dy)*1.2;
      if (goDown||goRight) {
        e.preventDefault();
        setDragging(true);
        setDragY(goDown?Math.max(0,dy):0);
        setDragX(goRight?Math.max(0,dx):0);
      }
    };
    const onEnd = () => {
      if (dragY>100||dragX>100) onDismiss();
      else { setDragY(0); setDragX(0); }
      setDragging(false);
    };
    el.addEventListener("touchstart", onStart, { passive:true });
    el.addEventListener("touchmove", onMove, { passive:false });
    el.addEventListener("touchend", onEnd, { passive:true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
    };
  }, [item && item.id, dragY, dragX]);

  if (!item) return null;

  const owner = OWNERS[item.ownerId];
  const alreadySent = requestSent[item.id];
  const rangeBooked = startDate && getDatesInRange(startDate, endDate||startDate).some(d => item.booked && item.booked.includes(d));
  const n = daysBetween(startDate, endDate||startDate);
  const progress = Math.min(1, Math.max(dragY,dragX)/200);
  const allPhotos = [...(item.uploadedImages||[]).map(i=>({ t:"img", s:i.url })), ...(item.photos||[]).map(p=>({ t:"emoji", s:p }))];
  const deliveryAmenity = item.amenities && item.amenities.find(a => /delivery/i.test(a) && /\$\d+/.test(a));
  const hasDelivery = !!deliveryAmenity;

  const sheetStyle = {
    background:"#fff", borderRadius:"16px 16px 0 0", padding:"20px 16px 40px", width:"100%", maxHeight:"90dvh", overflowY:"auto", borderTop:"1px solid #E4E6EB", overscrollBehavior:"contain",
    transform: "translateY("+dragY+"px) translateX("+(dragX*0.35)+"px)",
    transition: dragging?"none":"transform 0.32s cubic-bezier(0.32,0.72,0,1), opacity 0.2s",
    animation: dragY===0&&dragX===0?"slideUp 0.32s cubic-bezier(0.32,0.72,0,1)":"none",
    opacity: 1 - progress*0.45,
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,"+(0.55-progress*0.2)+")", zIndex:200, display:"flex", alignItems:"flex-end" }} onClick={onDismiss}>
      <div ref={sheetRef} style={sheetStyle} onClick={e=>e.stopPropagation()}>
        <div style={{ width:40, height:5, borderRadius:3, background:"#CDD0D4", margin:"0 auto 16px" }}/>

        {allPhotos.length > 0 && (
          <div style={{ display:"flex", gap:8, overflowX:"auto", scrollbarWidth:"none", marginBottom:16 }}>
            {allPhotos.map((p,i) => (
              <div key={i} onClick={()=>setPhotoBrowser({ uploadedImages:item.uploadedImages||[], photos:item.photos||[], startIdx:i })}
                style={{ minWidth:i===0?175:95, height:i===0?140:90, borderRadius:12, overflow:"hidden", flexShrink:0, cursor:"pointer", background:"#F0F2F5", display:"flex", alignItems:"center", justifyContent:"center", position:"relative" }}>
                {p.t==="img" ? <img src={p.s} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }}/> : <span style={{ fontSize:i===0?52:32 }}>{p.s}</span>}
                {i===0 && allPhotos.length>1 && <div style={{ position:"absolute", bottom:6, right:6, background:"rgba(0,0,0,0.55)", borderRadius:6, padding:"3px 7px", fontSize:10, color:"#fff" }}>{allPhotos.length} photos</div>}
              </div>
            ))}
          </div>
        )}

        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:6 }}>
          <div style={{ fontSize:19, fontWeight:800, color:"#1C1E21", flex:1, marginRight:10 }}>{item.title}</div>
          <button onClick={()=>toggleFav(item.id)} style={{ background:"none", border:"none", fontSize:22, cursor:"pointer" }}>{favorites.includes(item.id)?"❤️":"🤍"}</button>
        </div>

        <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:12, flexWrap:"wrap" }}>
          <span style={{ display:"inline-block", width:9, height:9, borderRadius:"50%", background:item.available?"#31A24C":"#FA3E3E" }}/>
          <span style={{ fontSize:13, fontWeight:600, color:item.available?"#31A24C":"#FA3E3E" }}>{item.available?"Available":"Unavailable"}</span>
          <span style={{ fontSize:13, color:"#65676B" }}>&middot; {item.distance}mi away</span>
          {(item.listingType==="sale"||item.listingType==="both") && (
            <span style={{ fontSize:11, fontWeight:700, color:"#E87722", background:"#FFF3E0", borderRadius:6, padding:"2px 7px", border:"1px solid #FFE0B2" }}>
              {item.listingType==="sale"?"For Sale":"Rent or Buy"}
            </span>
          )}
          {hasDelivery && <span style={{ fontSize:11, fontWeight:600, color:"#00B894", background:"#E8FBF6", borderRadius:6, padding:"2px 7px", border:"1px solid #B2EFE3" }}>Delivery avail.</span>}
        </div>

        {owner && (
          <div onClick={()=>setOwnerProfileId(item.ownerId)} style={{ display:"flex", alignItems:"center", gap:12, background:"#F7F8FA", borderRadius:12, padding:"12px 14px", marginBottom:16, cursor:"pointer", border:"1px solid #E4E6EB" }}>
            <div style={{ width:44, height:44, borderRadius:"50%", background:"#E4E6EB", display:"flex", alignItems:"center", justifyContent:"center", fontSize:24, flexShrink:0 }}>{item.ownerAvatar||owner.avatar}</div>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:700, fontSize:14, color:"#1C1E21", marginBottom:2 }}>{item.owner||owner.name}</div>
              <div style={{ fontSize:12, color:"#65676B" }}>
                {owner.verified && <span style={{ color:"#31A24C" }}>Verified &middot; </span>}
                {owner.responseTime}
              </div>
              {allItems.filter(x=>x.ownerId===item.ownerId&&x.id!==item.id).length > 0 && (
                <div style={{ fontSize:11, color:"#00B894", fontWeight:600, marginTop:2 }}>
                  +{allItems.filter(x=>x.ownerId===item.ownerId&&x.id!==item.id).length} other listings
                </div>
              )}
            </div>
            <div style={{ fontSize:12, color:"#00B894", fontWeight:700 }}>View ›</div>
          </div>
        )}

        {item.description && <div style={{ fontSize:13, color:"#65676B", lineHeight:1.7, marginBottom:14 }}>{item.description}</div>}

        {item.amenities && item.amenities.length > 0 && (
          <div style={{ marginBottom:14 }}>
            <div style={{ fontWeight:700, fontSize:13, color:"#1C1E21", marginBottom:8 }}>Included</div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
              {item.amenities.map((a,i) => <div key={i} style={{ background:"#F0F2F5", borderRadius:8, padding:"5px 10px", fontSize:12, color:"#1C1E21", border:"1px solid #E4E6EB" }}>{a}</div>)}
            </div>
          </div>
        )}

        <div style={{ background:"#F7F8FA", borderRadius:12, padding:"13px 15px", marginBottom:14, border:"1px solid #E4E6EB", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <div style={{ fontSize:10, color:"#8A8D91", marginBottom:3 }}>{item.listingType==="sale"?"Sale price":"Rental price"}</div>
            <div style={{ fontSize:24, fontWeight:800, color:"#00B894" }}>
              ${item.price}<span style={{ fontSize:12, color:"#8A8D91" }}>{item.listingType==="sale"?" firm":"/"+(item.priceUnit||"day")}</span>
            </div>
            {item.listingType==="both" && item.salePrice && <div style={{ fontSize:13, color:"#E87722", fontWeight:700, marginTop:2 }}>Buy: ${item.salePrice}</div>}
          </div>
          <div style={{ textAlign:"right" }}>
            <div style={{ fontSize:10, color:"#8A8D91", marginBottom:3 }}>Category</div>
            <div style={{ fontSize:13, fontWeight:700, color:"#1C1E21" }}>{CAT_MAP[item.category]||item.category}</div>
            {item.rating && <StarRow rating={item.rating} count={item.reviews} size={11}/>}
          </div>
        </div>

        {item.listingType==="sale" && item.available && (
          alreadySent
            ? <div style={{ width:"100%", padding:"14px", borderRadius:8, background:"#F0F2F5", color:"#65676B", textAlign:"center", fontWeight:700, fontSize:15, marginBottom:10 }}>Purchase Requested!</div>
            : <button style={{ width:"100%", padding:"14px", borderRadius:8, border:"none", fontFamily:"inherit", fontWeight:700, fontSize:15, cursor:"pointer", background:"#E87722", color:"#fff", marginBottom:10 }} onClick={()=>{ setPaymentModal({item,start:null,end:null}); setPaymentStep(1); }}>
                Buy Now — ${item.price}
              </button>
        )}

        {item.available && item.listingType!=="sale" && (
          <div>
            <div style={{ fontWeight:700, fontSize:14, color:"#1C1E21", marginBottom:10 }}>
              {item.category==="housing"?"Select check-in & check-out":"Select rental dates"}
            </div>
            <RangeCalendar booked={item.booked||[]} startDate={startDate} endDate={endDate} onRangeChange={(s,e)=>{ setStartDate(s); setEndDate(e); }}/>
            {startDate && (
              <div style={{ background:"#E8FBF6", borderRadius:10, padding:"11px 14px", margin:"10px 0", border:"1px solid #B2EFE3" }}>
                <div style={{ fontSize:13, fontWeight:700, color:"#00B894" }}>
                  {formatDate(startDate)}{endDate&&endDate!==startDate?" to "+formatDate(endDate):""} &middot; {n} {item.category==="housing"?"night":"day"}{n>1?"s":""}
                </div>
              </div>
            )}
            {startDate && <PaymentBreakdown price={item.price} priceUnit={item.priceUnit||"day"} nights={n}/>}
            {alreadySent
              ? <div style={{ width:"100%", padding:"14px", borderRadius:8, background:"#F0F2F5", color:"#65676B", textAlign:"center", fontWeight:700, fontSize:15 }}>Booking Requested!</div>
              : <button
                  style={{ width:"100%", padding:"14px", borderRadius:8, border:"none", fontFamily:"inherit", fontWeight:700, fontSize:15, cursor:(!startDate||rangeBooked)?"not-allowed":"pointer", background:"#00B894", color:"#fff", opacity:(!startDate||rangeBooked)?0.45:1 }}
                  onClick={()=>onConfirmBooking(startDate,endDate)} disabled={!startDate||rangeBooked}>
                  {!startDate?"Select dates to continue":rangeBooked?"Dates unavailable":"Request "+n+" "+(item.category==="housing"?"night":"day")+(n>1?"s":"")+" — $"+(item.price*n)}
                </button>
            }
            {item.listingType==="both" && item.salePrice && !alreadySent && (
              <button style={{ width:"100%", padding:"12px", borderRadius:8, border:"none", fontFamily:"inherit", fontWeight:700, fontSize:14, cursor:"pointer", background:"#E87722", color:"#fff", marginTop:8 }} onClick={()=>{ setPaymentModal({item,start:null,end:null}); setPaymentStep(1); }}>
                Or Buy Outright — ${item.salePrice}
              </button>
            )}
          </div>
        )}

        {!item.available && item.listingType!=="sale" && (
          <button style={{ width:"100%", padding:"14px", borderRadius:8, border:"none", fontFamily:"inherit", fontWeight:700, fontSize:15, cursor:"not-allowed", background:"#F0F2F5", color:"#8A8D91" }} disabled>Currently Unavailable</button>
        )}

        <div style={{ fontSize:11, color:"#8A8D91", textAlign:"center", margin:"14px 0 6px" }}>Swipe down or right to close</div>
        <button style={{ width:"100%", padding:"12px", borderRadius:8, border:"1px solid #CDD0D4", fontFamily:"inherit", fontWeight:600, fontSize:14, cursor:"pointer", background:"#fff", color:"#1C1E21" }} onClick={onDismiss}>Close</button>
      </div>
    </div>
  );
}

function AddListingModal({ show, onClose, newListing, setNewListing, addImages, setAddImages, onSubmit, S, C, ALL_CATS }) {
  if (!show) return null;
  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.sheet} onClick={e=>e.stopPropagation()}>
        <div style={{ fontSize:18, fontWeight:800, marginBottom:4, color:"#1C1E21" }}>Create a Listing</div>
        <div style={{ fontSize:12, color:C.muted, marginBottom:14 }}>Photos get 3x more requests</div>

        <div style={{ marginBottom:14 }}>
          <div style={{ fontSize:12, fontWeight:700, color:"#1C1E21", marginBottom:8 }}>What do you want to do?</div>
          <div style={{ display:"flex", gap:8 }}>
            {[["rent","Rent it out"],["sale","Sell it"],["both","Rent & Sell"]].map(([val,label])=>(
              <button key={val} onClick={()=>setNewListing(n=>({...n,listingType:val}))}
                style={{ flex:1, padding:"10px 4px", borderRadius:10, border:newListing.listingType===val?"2px solid #00B894":"1.5px solid #E4E6EB", background:newListing.listingType===val?"#E8FBF6":"#fff", color:newListing.listingType===val?"#00B894":"#65676B", fontSize:11, fontWeight:newListing.listingType===val?700:500, cursor:"pointer" }}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom:14 }}>
          <div style={{ fontSize:13, fontWeight:700, color:"#1C1E21", marginBottom:8 }}>Photos</div>
          <label htmlFor="nr-photo-input" style={{ border:"2px dashed #B2EFE3", borderRadius:12, padding:"18px 14px", textAlign:"center", cursor:"pointer", background:"#F0F8FF", marginBottom:8, display:"block" }}>
            <div style={{ fontSize:32, marginBottom:4 }}>📸</div>
            <div style={{ fontSize:13, fontWeight:700, color:"#00B894", marginBottom:2 }}>Tap to add photos</div>
            <div style={{ fontSize:11, color:C.muted }}>Camera, Gallery or Files</div>
            <input id="nr-photo-input" type="file" accept="image/*" multiple style={{ display:"none" }}
              onChange={e=>{ Array.from(e.target.files||[]).forEach(f=>{ if(!f.type.startsWith("image/"))return; const r=new FileReader(); r.onload=ev=>setAddImages(p=>[...p,{id:Date.now()+Math.random(),url:ev.target.result}]); r.readAsDataURL(f); }); }}/>
          </label>
          {addImages.length > 0 && (
            <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
              {addImages.map((img,i) => (
                <div key={img.id} style={{ position:"relative", width:76, height:76 }}>
                  <img src={img.url} alt="" style={{ width:76, height:76, borderRadius:10, objectFit:"cover", border:i===0?"2.5px solid #00B894":"1.5px solid #E4E6EB" }}/>
                  {i===0 && <div style={{ position:"absolute", top:3, left:3, background:"#00B894", borderRadius:5, padding:"2px 5px", fontSize:9, fontWeight:800, color:"#fff" }}>COVER</div>}
                  <button onClick={()=>setAddImages(p=>p.filter(x=>x.id!==img.id))} style={{ position:"absolute", top:-5, right:-5, background:"#FA3E3E", border:"2px solid #fff", borderRadius:"50%", width:20, height:20, color:"#fff", fontSize:12, cursor:"pointer", fontWeight:900, display:"flex", alignItems:"center", justifyContent:"center" }}>x</button>
                </div>
              ))}
              <label htmlFor="nr-photo-input" style={{ width:76, height:76, borderRadius:10, border:"2px dashed #B2EFE3", background:"#F0F8FF", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", cursor:"pointer" }}>
                <span style={{ fontSize:20, color:"#00B894" }}>+</span>
                <span style={{ fontSize:9, fontWeight:700, color:"#00B894" }}>More</span>
              </label>
            </div>
          )}
        </div>

        <div style={{ borderTop:"1px solid #E4E6EB", marginBottom:14 }}/>

        <div style={{ marginBottom:14 }}>
          <label style={S.lbl}>Category</label>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:6 }}>
            {ALL_CATS.map(cat=>(
              <button key={cat.id} onClick={()=>setNewListing(n=>({...n,category:cat.id,emoji:cat.emoji}))}
                style={{ padding:"9px 4px", borderRadius:10, border:newListing.category===cat.id?"2px solid #00B894":"1.5px solid #E4E6EB", background:newListing.category===cat.id?"#E8FBF6":"#fff", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:3 }}>
                <span style={{ fontSize:20 }}>{cat.emoji}</span>
                <span style={{ fontSize:9, fontWeight:newListing.category===cat.id?700:500, color:newListing.category===cat.id?"#00B894":"#65676B" }}>{cat.label}</span>
              </button>
            ))}
          </div>
          {newListing.category==="other" && <input style={{ ...S.inp, marginTop:8 }} placeholder="Describe category (e.g. Musical instruments)" autoComplete="off" value={newListing.otherCategory||""} onChange={e=>setNewListing(n=>({...n,otherCategory:e.target.value}))}/>}
        </div>

        <div style={S.fg}>
          <label style={S.lbl}>Name</label>
          <input style={S.inp} placeholder="e.g. Power Drill, Party Tent" autoComplete="off" autoCorrect="off" value={newListing.title} onChange={e=>setNewListing(n=>({...n,title:e.target.value}))}/>
        </div>
        <div style={{ display:"flex", gap:10 }}>
          <div style={{ ...S.fg, flex:2 }}>
            <label style={S.lbl}>{newListing.listingType==="sale"?"Asking Price ($)":"Rental Price ($)"}</label>
            <input style={S.inp} type="number" placeholder="25" value={newListing.price} onChange={e=>setNewListing(n=>({...n,price:e.target.value}))}/>
          </div>
          {newListing.listingType!=="sale" && (
            <div style={{ ...S.fg, flex:2 }}>
              <label style={S.lbl}>Per</label>
              <select style={S.sel} value={newListing.priceUnit} onChange={e=>setNewListing(n=>({...n,priceUnit:e.target.value}))}>
                <option value="hour">Hour</option>
                <option value="day">Day</option>
                <option value="week">Week</option>
                <option value="night">Night</option>
              </select>
            </div>
          )}
        </div>
        <div style={S.fg}>
          <label style={S.lbl}>Description</label>
          <textarea style={{ ...S.inp, minHeight:70, resize:"vertical" }} placeholder="Describe the item, condition, included..." autoComplete="off" autoCorrect="off" value={newListing.description} onChange={e=>setNewListing(n=>({...n,description:e.target.value}))}/>
        </div>
        <div style={S.fg}>
          <label style={S.lbl}>Amenities (comma-separated)</label>
          <input style={S.inp} placeholder="WiFi, Parking, Tables..." autoComplete="off" autoCorrect="off" value={newListing.amenities} onChange={e=>setNewListing(n=>({...n,amenities:e.target.value}))}/>
        </div>
        <div style={{ marginBottom:14 }}>
          <div style={{ fontSize:12, fontWeight:700, color:"#1C1E21", marginBottom:8 }}>Delivery?</div>
          <div style={{ display:"flex", gap:8 }}>
            {[["no","No - pickup only"],["yes","Yes - I deliver"]].map(([val,label])=>(
              <button key={val} onClick={()=>setNewListing(n=>({...n,offersDelivery:val==="yes",deliveryFee:val==="no"?"":n.deliveryFee}))}
                style={{ flex:1, padding:"10px 8px", borderRadius:10, border:newListing.offersDelivery===(val==="yes")?"2px solid #00B894":"1.5px solid #E4E6EB", background:newListing.offersDelivery===(val==="yes")?"#E8FBF6":"#fff", color:newListing.offersDelivery===(val==="yes")?"#00B894":"#65676B", fontSize:12, fontWeight:newListing.offersDelivery===(val==="yes")?700:500, cursor:"pointer" }}>
                {label}
              </button>
            ))}
          </div>
          {newListing.offersDelivery && (
            <div style={{ display:"flex", alignItems:"center", gap:10, marginTop:8 }}>
              <span style={{ fontSize:13, color:"#65676B" }}>Fee: $</span>
              <input style={{ ...S.inp, width:90 }} type="number" placeholder="25" value={newListing.deliveryFee||""} onChange={e=>setNewListing(n=>({...n,deliveryFee:e.target.value}))}/>
            </div>
          )}
        </div>
        <button style={S.pBtn} onClick={onSubmit}>Publish Listing</button>
        <button style={S.gBtn} onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

function ChatView({ activeConvo, setActiveConvo, chatMsg, setChatMsg, messages, setMessages, msgEndRef }) {
  if (!activeConvo) return null;
  const sendMsg = () => {
    if (!chatMsg.trim()) return;
    const newMsg = { mine:true, text:chatMsg, time:"Now" };
    setMessages(prev=>prev.map(m=>m.id===activeConvo.id?{...m,messages:[...(m.messages||[]),newMsg],unread:false}:m));
    setActiveConvo(c=>({...c,messages:[...(c.messages||[]),newMsg]}));
    setChatMsg("");
  };
  return (
    <div style={{ position:"fixed", inset:0, background:"#fff", zIndex:600, display:"flex", flexDirection:"column", maxWidth:430, margin:"0 auto" }}>
      <div style={{ background:"#fff", padding:"14px 16px 12px", borderBottom:"1px solid #E4E6EB", display:"flex", alignItems:"center", gap:12 }}>
        <button onClick={()=>setActiveConvo(null)} style={{ background:"#F0F2F5", border:"none", borderRadius:10, width:34, height:34, cursor:"pointer", fontSize:18 }}>&larr;</button>
        <div style={{ fontSize:36 }}>{activeConvo.avatar}</div>
        <div>
          <div style={{ fontWeight:700, fontSize:15, color:"#1C1E21" }}>{activeConvo.from}</div>
          <div style={{ fontSize:12, color:"#65676B" }}>{activeConvo.item}</div>
        </div>
      </div>
      <div style={{ flex:1, overflowY:"auto", padding:"16px", background:"#F0F2F5" }}>
        {(activeConvo.thread||activeConvo.messages||[]).map((m,i)=>(
          <div key={i} style={{ display:"flex", justifyContent:m.mine?"flex-end":"flex-start", marginBottom:10 }}>
            <div style={{ background:m.mine?"#00B894":"#fff", color:m.mine?"#fff":"#1C1E21", borderRadius:m.mine?"16px 16px 4px 16px":"16px 16px 16px 4px", padding:"10px 14px", fontSize:13, maxWidth:"75%", boxShadow:"0 1px 3px rgba(0,0,0,0.08)" }}>
              {m.text}
              <div style={{ fontSize:10, color:m.mine?"rgba(255,255,255,0.7)":"#8A8D91", marginTop:4, textAlign:"right" }}>{m.time}</div>
            </div>
          </div>
        ))}
        <div ref={msgEndRef}/>
      </div>
      <div style={{ background:"#fff", padding:"12px 16px", borderTop:"1px solid #E4E6EB", display:"flex", gap:8 }}>
        <input
          value={chatMsg}
          onChange={e=>setChatMsg(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&sendMsg()}
          placeholder="Message..."
          autoComplete="off"
          style={{ flex:1, background:"#F0F2F5", border:"none", borderRadius:24, padding:"10px 16px", fontSize:14, outline:"none", fontFamily:"inherit" }}
        />
        <button onClick={sendMsg} style={{ background:"#00B894", border:"none", borderRadius:"50%", width:42, height:42, color:"#fff", cursor:"pointer", fontSize:20, display:"flex", alignItems:"center", justifyContent:"center" }}>&#8593;</button>
      </div>
    </div>
  );
}

function dbToListing(row) {
  return {
    id: row.id,
    title: row.title,
    price: Number(row.price),
    priceUnit: row.price_unit || 'day',
    category: row.category,
    emoji: row.emoji || '📦',
    color: row.color,
    description: row.description || '',
    amenities: row.amenities || [],
    capacity: row.capacity,
    available: row.available,
    booked: row.booked || [],
    views: row.views || 0,
    requests: row.requests || 0,
    earnings: row.earnings || 0,
    rating: row.rating,
    reviews: row.reviews || 0,
    listingType: row.listing_type || 'rent',
    offersDelivery: row.offers_delivery || false,
    deliveryFee: row.delivery_fee,
    uploadedImages: row.uploaded_images || [],
    photos: row.photos || [],
  };
}

function listingToDb(listing) {
  return {
    title: listing.title,
    price: Number(listing.price),
    price_unit: listing.priceUnit || 'day',
    category: listing.category,
    emoji: listing.emoji || '📦',
    color: listing.color,
    description: listing.description || '',
    amenities: listing.amenities || [],
    capacity: listing.capacity || null,
    available: listing.available !== undefined ? listing.available : true,
    booked: listing.booked || [],
    views: listing.views || 0,
    requests: listing.requests || 0,
    earnings: listing.earnings || 0,
    rating: listing.rating || null,
    reviews: listing.reviews || 0,
    listing_type: listing.listingType || 'rent',
    offers_delivery: listing.offersDelivery || false,
    delivery_fee: listing.deliveryFee ? Number(listing.deliveryFee) : null,
    uploaded_images: listing.uploadedImages || [],
    photos: listing.photos || [],
  };
}

function AuthModal({ show, initialMode = "login", onClose }) {
  const [mode, setMode] = useState(initialMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (show) { setMode(initialMode); setName(""); setEmail(""); setPassword(""); setError(""); setLoading(false); }
  }, [show, initialMode]);

  if (!show) return null;

  const submit = async () => {
    setError("");
    if (!email || !password) { setError("Email and password are required"); return; }
    if (mode === "signup" && !name.trim()) { setError("Name is required"); return; }
    if (password.length < 6) { setError("Password must be at least 6 characters"); return; }
    setLoading(true);
    if (mode === "login") {
      const { error: e } = await supabase.auth.signInWithPassword({ email, password });
      if (e) { setError(e.message); setLoading(false); }
      else onClose();
    } else {
      const { error: e } = await supabase.auth.signUp({ email, password, options: { data: { name: name.trim() } } });
      if (e) { setError(e.message); }
      else setError("Check your email to confirm your account, then sign in.");
      setLoading(false);
    }
  };

  const inp = { width:"100%", background:"#F7F8FA", border:"1.5px solid #E4E6EB", borderRadius:12, padding:"14px 16px", color:"#1C1E21", fontFamily:"inherit", fontSize:15, outline:"none", boxSizing:"border-box" };
  const lbl = { fontSize:13, fontWeight:600, color:"#1C1E21", marginBottom:6, display:"block" };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", zIndex:800, display:"flex", alignItems:"flex-end" }} onClick={onClose}>
      <div style={{ background:"#fff", borderRadius:"16px 16px 0 0", width:"100%", maxWidth:430, margin:"0 auto", maxHeight:"92dvh", overflowY:"auto" }} onClick={e=>e.stopPropagation()}>
        <div style={{ background:"#00B894", padding:"18px 24px 22px", textAlign:"center", borderRadius:"16px 16px 0 0" }}>
          <div style={{ width:40, height:5, borderRadius:3, background:"rgba(255,255,255,0.35)", margin:"0 auto 14px" }}/>
          <div style={{ fontSize:26, fontWeight:900, color:"#fff", letterSpacing:-0.5, fontFamily:"'Helvetica Neue',Arial,sans-serif" }}>lendie</div>
          <div style={{ fontSize:13, color:"rgba(255,255,255,0.85)", marginTop:4 }}>
            {mode==="login" ? "Welcome back!" : "Join thousands of neighbors sharing nearby"}
          </div>
        </div>
        <div style={{ padding:"20px 24px 48px" }}>
          <div style={{ display:"flex", background:"#F0F2F5", borderRadius:12, padding:4, marginBottom:20 }}>
            {[["login","Sign In"],["signup","Sign Up"]].map(([m,l])=>(
              <button key={m} onClick={()=>{ setMode(m); setError(""); }} style={{ flex:1, padding:"10px", borderRadius:9, border:"none", fontFamily:"inherit", fontWeight:700, fontSize:14, cursor:"pointer", background:mode===m?"#00B894":"transparent", color:mode===m?"#fff":"#65676B", transition:"all 0.18s" }}>{l}</button>
            ))}
          </div>

          {mode==="signup" && (
            <div style={{ marginBottom:14 }}>
              <label style={lbl}>Your Name</label>
              <input style={inp} placeholder="e.g. Alex Johnson" value={name} onChange={e=>setName(e.target.value)} autoComplete="name"/>
            </div>
          )}

          <div style={{ marginBottom:14 }}>
            <label style={lbl}>Email</label>
            <input style={inp} type="email" placeholder="you@email.com" value={email} onChange={e=>setEmail(e.target.value)} autoComplete="email"/>
          </div>

          <div style={{ marginBottom:20 }}>
            <label style={lbl}>Password</label>
            <input style={inp} type="password" placeholder={mode==="signup"?"At least 6 characters":"Your password"} value={password} onChange={e=>setPassword(e.target.value)} autoComplete={mode==="signup"?"new-password":"current-password"} onKeyDown={e=>e.key==="Enter"&&submit()}/>
          </div>

          {error && (
            <div style={{ borderRadius:10, padding:"11px 14px", marginBottom:16, fontSize:13, border:"1px solid", ...(error.startsWith("Check")?{ background:"#E8FBF6", color:"#00A67E", borderColor:"#B2EFE3" }:{ background:"#FFF0F0", color:"#FA3E3E", borderColor:"#FFCDD2" }) }}>
              {error}
            </div>
          )}

          <button onClick={submit} disabled={loading} style={{ width:"100%", padding:"15px", borderRadius:12, border:"none", fontFamily:"inherit", fontWeight:800, fontSize:16, cursor:loading?"not-allowed":"pointer", background:"#00B894", color:"#fff", opacity:loading?0.7:1, marginBottom:12 }}>
            {loading ? "…" : mode==="login" ? "Sign In" : "Create Account"}
          </button>

          <div style={{ textAlign:"center", fontSize:13, color:"#65676B" }}>
            {mode==="login" ? "New to Lendie? " : "Already have an account? "}
            <span onClick={()=>{ setMode(mode==="login"?"signup":"login"); setError(""); }} style={{ color:"#00B894", fontWeight:700, cursor:"pointer" }}>
              {mode==="login" ? "Sign Up" : "Sign In"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Lendie() {
  const [tab, setTab] = useState("browse");
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState("grid");
  const [selectedItem, setSelectedItem] = useState(null);
  const [startDate, setStartDate] = useState(null);
  const [endDate, setEndDate] = useState(null);
  const [favorites, setFavorites] = useState([]);
  const [showFavOnly, setShowFavOnly] = useState(false);
  const [requestSent, setRequestSent] = useState({});
  const [paymentModal, setPaymentModal] = useState(null);
  const [paymentStep, setPaymentStep] = useState(1);
  const [wantsDelivery, setWantsDelivery] = useState(false);
  const [cardNum, setCardNum] = useState("");
  const [cardExp, setCardExp] = useState("");
  const [cardCvv, setCardCvv] = useState("");
  const [cardName, setCardName] = useState("");
  const [payMethod, setPayMethod] = useState("card");
  const [ownerProfileId, setOwnerProfileId] = useState(null);
  const [photoBrowser, setPhotoBrowser] = useState(null);
  const [myListings, setMyListings] = useState([]);
  const [listingsLoading, setListingsLoading] = useState(true);
  const [addImages, setAddImages] = useState([]);
  const [showAddListing, setShowAddListing] = useState(false);
  const [newListing, setNewListing] = useState({ title:"", price:"", priceUnit:"day", category:"tools", emoji:"🔧", description:"", amenities:"", capacity:"", listingType:"rent", offersDelivery:false, deliveryFee:"" });
  const [managingListing, setManagingListing] = useState(null);
  const [editingListing, setEditingListing] = useState(null);
  const [editImages, setEditImages] = useState([]);
  const [deletingId, setDeletingId] = useState(null);
  const [messages, setMessages] = useState(SEED_MESSAGES);
  const [activeConvo, setActiveConvo] = useState(null);
  const [draftMsg, setDraftMsg] = useState("");
  const [chatMsg, setChatMsg] = useState("");
  const [notifications, setNotifications] = useState(NOTIFICATION_SEED);
  const [showNotifs, setShowNotifs] = useState(false);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [locationText, setLocationText] = useState("Current Location");
  const [radius, setRadius] = useState(5);
  const [sortBy, setSortBy] = useState("distance");
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const msgEndRef = useRef(null);
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authModalMode, setAuthModalMode] = useState("login");

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) { setMyListings([]); setListingsLoading(false); return; }
    setListingsLoading(true);
    supabase.from('listings').select('*').eq('user_id', user.id).order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (!error && data) setMyListings(data.map(dbToListing));
        setListingsLoading(false);
      });
  }, [user?.id]);

  const requireAuth = (mode = "login") => {
    if (user) return true;
    setAuthModalMode(mode);
    setShowAuthModal(true);
    return false;
  };

  const showToast = (msg, type="success") => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, type });
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  };
  const toggleFav = id => setFavorites(f => f.includes(id) ? f.filter(x=>x!==id) : [...f,id]);
  const unreadMsgs = messages.filter(m=>m.unread).length;
  const unreadNotifs = notifications.filter(n=>n.unread).length;

  const allItems = [
    ...SEED_ITEMS,
    ...HOUSING_ITEMS,
    ...myListings.map(l=>({ ...l, owner:"You", ownerAvatar:"🧑", ownerId:"me", distance:0, lat:40.714, lng:-74.006, reviews:l.reviews||0, uploadedImages:l.uploadedImages||[] }))
  ];

  const filtered = allItems.filter(item => {
    if (showFavOnly && !favorites.includes(item.id)) return false;
    if (category!=="all" && category!=="everything" && item.category!==category) return false;
    if (search && !item.title.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }).sort((a,b) => {
    if (sortBy==="price") return a.price-b.price;
    if (sortBy==="rating") return (b.rating||0)-(a.rating||0);
    return a.distance-b.distance;
  });

  const C = { bg:"#F0F2F5", surface:"#FFFFFF", border:"#E4E6EB", accent:"#00B894", text:"#1C1E21", muted:"#65676B", faint:"#8A8D91" };
  const S = {
    app:{ fontFamily:"'Helvetica Neue',Arial,sans-serif", background:C.bg, minHeight:"100vh", maxWidth:430, margin:"0 auto", color:C.text, paddingBottom:84 },
    overlay:{ position:"fixed", inset:0, height:"100dvh", background:"rgba(0,0,0,0.55)", zIndex:300, display:"flex", alignItems:"flex-end" },
    sheet:{ background:"#fff", borderRadius:"16px 16px 0 0", padding:"20px 16px calc(40px + env(safe-area-inset-bottom, 0px))", width:"100%", maxHeight:"90dvh", overflowY:"auto", borderTop:"1px solid #E4E6EB", overscrollBehavior:"contain" },
    pBtn:{ width:"100%", padding:"14px", borderRadius:8, border:"none", fontFamily:"inherit", fontWeight:700, fontSize:15, cursor:"pointer", background:"#00B894", color:"#fff", marginBottom:10 },
    gBtn:{ width:"100%", padding:"12px", borderRadius:8, border:"1px solid #CDD0D4", fontFamily:"inherit", fontWeight:600, fontSize:14, cursor:"pointer", background:"#fff", color:"#1C1E21" },
    fg:{ marginBottom:14 },
    lbl:{ fontSize:12, fontWeight:600, color:C.text, marginBottom:6, display:"block" },
    inp:{ width:"100%", background:"#F0F2F5", border:"1.5px solid #CDD0D4", borderRadius:8, padding:"11px 13px", color:C.text, fontFamily:"inherit", fontSize:14, outline:"none", boxSizing:"border-box" },
    sel:{ width:"100%", background:"#F0F2F5", border:"1.5px solid #CDD0D4", borderRadius:8, padding:"11px 13px", color:C.text, fontFamily:"inherit", fontSize:14, outline:"none" },
    nav:{ position:"fixed", bottom:0, left:"50%", transform:"translateX(-50%)", width:"100%", maxWidth:430, background:"#fff", borderTop:"1px solid #E4E6EB", display:"flex", zIndex:100 },
  };
  const CAT_EMOJI_MAP = { tools:"🔧", trailers:"🚛", construction:"🏗️", kitchen:"🍳", garden:"🌱", outdoors:"🏕️", venues:"🏛️", party:"🎉", vehicles:"🚗", tech:"💻", housing:"🏠", other:"📦" };

  const handleAddListing = async () => {
    if (!newListing.title || !newListing.price) { showToast("Fill in name and price","error"); return; }
    const colors = ["#F59E0B","#EC4899","#10B981","#3B82F6","#8B5CF6","#EF4444"];
    const amenArr = newListing.amenities ? newListing.amenities.split(",").map(a=>a.trim()).filter(Boolean) : [];
    if (newListing.offersDelivery && newListing.deliveryFee) amenArr.push("Delivery available (+$"+newListing.deliveryFee+")");
    const dbRow = {
      ...listingToDb({
        ...newListing, price: Number(newListing.price),
        color: colors[Math.floor(Math.random()*colors.length)],
        available: true, booked: [], views: 0, requests: 0, earnings: 0, rating: null, reviews: 0,
        amenities: amenArr, capacity: newListing.capacity ? Number(newListing.capacity) : null,
        photos: [newListing.emoji||"📦","📸"], uploadedImages: [...addImages],
      }),
      user_id: user?.id,
    };
    const { data, error } = await supabase.from('listings').insert(dbRow).select().single();
    if (error) { showToast("Failed to save listing","error"); console.error(error); return; }
    setMyListings(prev=>[dbToListing(data), ...prev]);
    setNewListing({ title:"", price:"", priceUnit:"day", category:"tools", emoji:"🔧", description:"", amenities:"", capacity:"", listingType:"rent", offersDelivery:false, deliveryFee:"" });
    setAddImages([]);
    setShowAddListing(false);
    showToast("Listing published!");
  };

  const handleEditSave = async () => {
    const { error } = await supabase.from('listings').update(listingToDb({...editingListing,uploadedImages:editImages})).eq('id', editingListing.id);
    if (error) { showToast("Failed to update","error"); return; }
    setMyListings(prev=>prev.map(l=>l.id===editingListing.id?{...l,...editingListing,uploadedImages:editImages}:l));
    setEditingListing(null);
    showToast("Listing updated!");
  };

  const handlePaymentConfirm = () => {
    if (paymentStep===1) { setPaymentStep(2); return; }
    const { item, start, end } = paymentModal;
    setRequestSent(r=>({...r,[item.id]:true}));
    setPaymentModal(null); setPaymentStep(1); setWantsDelivery(false);
    setSelectedItem(null);
    showToast("Booking confirmed!");
    setNotifications(prev=>[{ id:Date.now(), icon:"✅", text:"Booking confirmed: "+item.title, sub:formatDate(start)+(end&&end!==start?" - "+formatDate(end):""), time:"Just now", unread:true, type:"confirm" },...prev]);
  };

  const TABS = [
    ["all","For you"],["everything","All"],["tools","Tools"],["trailers","Trailers"],["construction","Equipment"],
    ["kitchen","Kitchen"],["garden","Garden"],["outdoors","Outdoors"],["venues","Venues"],
    ["party","Party"],["tech","Tech"],["housing","Housing"],["vehicles","Vehicles"]
  ];
  const ALL_CATS = [
    {id:"tools",label:"Tools",emoji:"🔧"},{id:"trailers",label:"Trailers",emoji:"🚛"},
    {id:"construction",label:"Equipment",emoji:"🏗️"},{id:"kitchen",label:"Kitchen",emoji:"🍳"},
    {id:"garden",label:"Garden",emoji:"🌱"},{id:"outdoors",label:"Outdoors",emoji:"🏕️"},
    {id:"venues",label:"Venues",emoji:"🏛️"},{id:"party",label:"Party",emoji:"🎉"},
    {id:"vehicles",label:"Vehicles",emoji:"🚗"},{id:"tech",label:"Tech",emoji:"💻"},
    {id:"housing",label:"Housing",emoji:"🏠"},{id:"other",label:"Other",emoji:"📦"}
  ];

  const CardGrid = () => (
    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:3, padding:3, background:"#E4E6EB" }}>
      {filtered.filter(item=>item.category!=="housing").map(item => {
        const deliveryBadge = item.amenities && item.amenities.find(a=>/delivery/i.test(a));
        return (
          <div key={item.id} style={{ background:"#fff", overflow:"hidden", cursor:"pointer", position:"relative" }} onClick={()=>setSelectedItem(item)}>
            <div style={{ background:(item.color||"#eee")+"15", display:"flex", alignItems:"center", justifyContent:"center", fontSize:44, height:155, position:"relative", overflow:"hidden" }}>
              {item.uploadedImages && item.uploadedImages[0]
                ? <img src={item.uploadedImages[0].url} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }}/>
                : <span>{item.emoji}</span>}
              <div style={{ position:"absolute", top:8, left:8, width:10, height:10, borderRadius:"50%", background:item.available?"#31A24C":"#FA3E3E", border:"2px solid #fff" }}/>
              <button style={{ position:"absolute", top:8, right:8, background:"rgba(255,255,255,0.9)", border:"none", borderRadius:"50%", width:30, height:30, cursor:"pointer", fontSize:15, display:"flex", alignItems:"center", justifyContent:"center" }} onClick={e=>{e.stopPropagation();toggleFav(item.id);}}>
                {favorites.includes(item.id)?"❤️":"🤍"}
              </button>
            </div>
            <div style={{ padding:"8px 10px 12px" }}>
              <div style={{ fontWeight:600, fontSize:13, marginBottom:1, color:"#1C1E21" }}>{item.title}</div>
              <div style={{ fontSize:11, color:"#65676B", marginBottom:3 }}>{item.owner||"You"} &middot; {item.distance===0?"Just listed":item.distance+"mi"}</div>
              {deliveryBadge && <div style={{ fontSize:10, fontWeight:600, color:"#00B894", background:"#E8FBF6", borderRadius:5, padding:"2px 6px", display:"inline-block", marginBottom:4, border:"1px solid #B2EFE3" }}>Delivery avail.</div>}
              {(item.listingType==="sale"||item.listingType==="both") && <div style={{ fontSize:10, fontWeight:700, color:"#E87722", background:"#FFF3E0", borderRadius:5, padding:"2px 6px", display:"inline-block", marginBottom:4, border:"1px solid #FFE0B2" }}>{item.listingType==="sale"?"For Sale":"Rent or Buy"}</div>}
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-end" }}>
                <div>
                  {item.listingType!=="sale" && <div><span style={{ fontSize:15, fontWeight:700, color:"#1C1E21" }}>${item.price}</span><span style={{ fontSize:9, color:"#8A8D91" }}>/{item.priceUnit||"day"}</span></div>}
                  {item.listingType==="sale" && <div><span style={{ fontSize:15, fontWeight:700, color:"#E87722" }}>${item.price}</span><span style={{ fontSize:9, color:"#8A8D91" }}> firm</span></div>}
                  {item.listingType==="both" && (
                    <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                      <span style={{ fontSize:15, fontWeight:700, color:"#1C1E21" }}>${item.price}</span><span style={{ fontSize:9, color:"#8A8D91" }}>/{item.priceUnit||"day"}</span>
                      {item.salePrice && <span style={{ fontSize:10, fontWeight:700, color:"#E87722", background:"#FFF3E0", borderRadius:5, padding:"1px 5px", border:"1px solid #FFE0B2" }}>Buy ${item.salePrice}</span>}
                    </div>
                  )}
                </div>
                {item.rating && <div style={{ fontSize:11, color:"#F5A623" }}>&#9733;{item.rating}</div>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );

  const PaymentModal = () => {
    if (!paymentModal) return null;
    const { item, start, end } = paymentModal;
    const n2 = daysBetween(start, end);
    const sub = item.price * (n2||1);
    const fee = Math.round(sub*0.12);
    const delivAmn = item.amenities && item.amenities.find(a=>/delivery/i.test(a)&&/\$\d+/.test(a));
    const delivFee = delivAmn ? parseInt(delivAmn.match(/\$(\d+)/)[1]) : null;
    const delivCost = (delivFee && wantsDelivery) ? delivFee : 0;
    const total = sub + fee + delivCost;
    const dismiss = () => { setPaymentModal(null); setPaymentStep(1); setWantsDelivery(false); };
    return (
      <div style={{ ...S.overlay, zIndex:400 }} onClick={dismiss}>
        <div style={{ ...S.sheet, zIndex:401 }} onClick={e=>e.stopPropagation()}>
          {paymentStep===1 ? (
            <div>
              <div style={{ textAlign:"center", marginBottom:20 }}>
                <div style={{ fontSize:36, marginBottom:8 }}>{item.emoji}</div>
                <div style={{ fontSize:18, fontWeight:800, color:"#1C1E21" }}>Confirm {item.listingType==="sale"?"Purchase":"Booking"}</div>
                <div style={{ fontSize:13, color:C.muted, marginTop:4 }}>{item.title}{start?" &middot; "+formatDate(start):""}</div>
              </div>
              {delivFee && (
                <div onClick={()=>setWantsDelivery(d=>!d)} style={{ display:"flex", alignItems:"center", gap:12, background:wantsDelivery?"#E8FBF6":"#F7F8FA", borderRadius:14, padding:"14px 16px", marginBottom:14, border:wantsDelivery?"1.5px solid #00B894":"1.5px solid #E4E6EB", cursor:"pointer" }}>
                  <div style={{ fontSize:28 }}>🚚</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:700, fontSize:14, color:"#1C1E21" }}>Add Delivery</div>
                    <div style={{ fontSize:12, color:C.muted }}>Seller delivers to your address</div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontSize:14, fontWeight:800, color:wantsDelivery?"#00B894":"#1C1E21" }}>+${delivFee}</div>
                    <div style={{ width:44, height:24, borderRadius:12, background:wantsDelivery?"#00B894":"#CDD0D4", position:"relative", marginTop:4, transition:"background 0.2s" }}>
                      <div style={{ position:"absolute", top:3, left:wantsDelivery?22:3, width:18, height:18, borderRadius:"50%", background:"#fff", transition:"left 0.2s", boxShadow:"0 1px 3px rgba(0,0,0,0.2)" }}/>
                    </div>
                  </div>
                </div>
              )}
              <div style={{ background:"#F7F8FA", borderRadius:14, padding:"14px 16px", marginBottom:16, border:"1px solid #E4E6EB" }}>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8, fontSize:13, color:C.muted }}><span>${item.price} x {n2||1}</span><span>${sub}</span></div>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8, fontSize:13, color:C.muted }}><span>Service fee (12%)</span><span>${fee}</span></div>
                {delivCost>0 && <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8, fontSize:13, color:"#00B894" }}><span>Delivery</span><span>${delivCost}</span></div>}
                <div style={{ display:"flex", justifyContent:"space-between", fontWeight:800, fontSize:17, borderTop:"1px solid #E4E6EB", paddingTop:10 }}>
                  <span>Total</span><span style={{ color:"#00B894" }}>${total}</span>
                </div>
              </div>
              <button style={S.pBtn} onClick={handlePaymentConfirm}>Continue to Payment</button>
              <button style={S.gBtn} onClick={dismiss}>Cancel</button>
            </div>
          ) : (
            <div>
              <div style={{ textAlign:"center", marginBottom:20 }}>
                <div style={{ fontSize:18, fontWeight:800, color:"#1C1E21" }}>Choose Payment</div>
                <div style={{ fontSize:13, color:C.muted, marginTop:4 }}>Total: <span style={{ color:"#00B894", fontWeight:800 }}>${total}</span></div>
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:10, marginBottom:16 }}>
                <button onClick={()=>{ setPayMethod("apple"); handlePaymentConfirm(); }} style={{ width:"100%", padding:"16px", borderRadius:12, border:"none", background:"#000", color:"#fff", fontFamily:"inherit", fontWeight:700, fontSize:16, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="white"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>
                  Pay with Apple Pay
                </button>
                <button onClick={()=>{ setPayMethod("google"); handlePaymentConfirm(); }} style={{ width:"100%", padding:"16px", borderRadius:12, border:"1.5px solid #E4E6EB", background:"#fff", color:"#1C1E21", fontFamily:"inherit", fontWeight:600, fontSize:16, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
                  <svg width="22" height="22" viewBox="0 0 24 24"><path d="M12 10.8v2.6h3.6c-.15.9-.6 1.7-1.28 2.2l2.07 1.6c1.21-1.12 1.91-2.77 1.91-4.73 0-.46-.04-.9-.12-1.33H12z" fill="#4285F4"/><path d="M5.51 14.26l-.46.35-1.63 1.27C4.43 17.82 6.99 19.5 10 19.5c2.7 0 4.96-.89 6.61-2.43l-2.07-1.6c-.89.6-2.03.95-3.28.95-2.56 0-4.73-1.73-5.75-4.16z" fill="#34A853"/><path d="M3.42 7.12A7.87 7.87 0 0 0 3 9.75c0 .93.13 1.83.37 2.68L5.5 10.8a4.73 4.73 0 0 1 0-3.44L3.42 7.12z" fill="#FBBC05"/><path d="M10 5.5c1.44 0 2.73.49 3.74 1.46l2.06-2.06C14.37 3.34 12.36 2.5 10 2.5 6.99 2.5 4.43 4.18 3.42 6.62L5.5 8.24C6.53 5.81 8.44 5.5 10 5.5z" fill="#EA4335"/></svg>
                  Pay with Google Pay
                </button>
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:16 }}>
                <div style={{ flex:1, height:1, background:"#E4E6EB" }}/><span style={{ fontSize:12, color:C.muted, fontWeight:600 }}>or pay by card</span><div style={{ flex:1, height:1, background:"#E4E6EB" }}/>
              </div>
              <div style={S.fg}><label style={S.lbl}>Name on card</label><input style={S.inp} placeholder="Jane Smith" value={cardName} onChange={e=>setCardName(e.target.value)}/></div>
              <div style={S.fg}><label style={S.lbl}>Card number</label><input style={S.inp} placeholder=".... .... .... ...." value={cardNum} maxLength={19} onChange={e=>setCardNum(e.target.value.replace(/\D/g,"").replace(/(.{4})/g,"$1 ").trim())}/></div>
              <div style={{ display:"flex", gap:10 }}>
                <div style={{ ...S.fg, flex:1 }}><label style={S.lbl}>Expiry</label><input style={S.inp} placeholder="MM/YY" value={cardExp} maxLength={5} onChange={e=>setCardExp(e.target.value)}/></div>
                <div style={{ ...S.fg, flex:1 }}><label style={S.lbl}>CVV</label><input style={S.inp} placeholder="..." maxLength={4} value={cardCvv} onChange={e=>setCardCvv(e.target.value.replace(/\D/g,""))} type="password"/></div>
              </div>
              <div style={{ background:"#F0FFF4", borderRadius:10, padding:"10px 14px", marginBottom:16, fontSize:12, color:"#31A24C", border:"1px solid #C6F6D5" }}>
                Payment held securely until {wantsDelivery?"delivery":"pickup"} confirmed
              </div>
              <button style={S.pBtn} onClick={handlePaymentConfirm}>Pay ${total} with Card</button>
              <button style={S.gBtn} onClick={()=>setPaymentStep(1)}>Back</button>
            </div>
          )}
        </div>
      </div>
    );
  };


  const NotifPanel = () => {
    if (!showNotifs) return null;
    return (
      <div style={{ ...S.overlay, zIndex:500 }} onClick={()=>setShowNotifs(false)}>
        <div style={{ ...S.sheet, zIndex:501 }} onClick={e=>e.stopPropagation()}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
            <div style={{ fontSize:17, fontWeight:800, color:"#1C1E21" }}>Notifications</div>
            <button onClick={()=>{ setNotifications(prev=>prev.map(n=>({...n,unread:false}))); }} style={{ background:"none", border:"none", color:"#00B894", fontSize:12, fontWeight:700, cursor:"pointer" }}>Mark all read</button>
          </div>
          {notifications.length===0 && <div style={{ textAlign:"center", padding:"40px 20px", color:"#65676B" }}>No notifications</div>}
          {notifications.map(n=>(
            <div key={n.id} style={{ display:"flex", gap:12, padding:"12px 0", borderBottom:"1px solid #F0F2F5", alignItems:"flex-start" }}>
              <div style={{ width:42, height:42, borderRadius:"50%", background:"#E8FBF6", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>{n.icon}</div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:13, fontWeight:n.unread?700:500, color:"#1C1E21" }}>{n.text}</div>
                <div style={{ fontSize:11, color:"#65676B", marginTop:2 }}>{n.sub}</div>
                <div style={{ fontSize:10, color:"#8A8D91", marginTop:2 }}>{n.time}</div>
              </div>
              {n.unread && <div style={{ width:8, height:8, borderRadius:"50%", background:"#00B894", flexShrink:0, marginTop:4 }}/>}
            </div>
          ))}
          <button style={{ ...S.gBtn, marginTop:16 }} onClick={()=>setShowNotifs(false)}>Close</button>
        </div>
      </div>
    );
  };


  return (
    <div style={S.app}>
      <style>{`@keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}`}</style>
      {tab==="browse" && (
        <div>
          <div style={{ background:"#fff", borderBottom:"1px solid #E4E6EB", position:"sticky", top:0, zIndex:50, willChange:"transform", transform:"translateZ(0)" }} onClick={e=>e.stopPropagation()}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 14px 8px" }}>
              <div style={{ fontSize:26, fontWeight:900, color:"#00B894", letterSpacing:-0.5, fontFamily:"'Helvetica Neue',Arial,sans-serif" }}>lendie<span style={{ opacity:0.45, fontSize:20 }}>.app</span></div>
              <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                {user ? (
                  <>
                    <button style={{ background:"#F0F2F5", border:"none", borderRadius:"50%", width:36, height:36, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", fontSize:17 }} onClick={()=>setShowFavOnly(f=>!f)}>{showFavOnly?"❤️":"🤍"}</button>
                    <button style={{ position:"relative", background:"#F0F2F5", border:"none", borderRadius:"50%", width:36, height:36, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", fontSize:17 }} onClick={()=>setShowNotifs(true)}>
                      🔔{unreadNotifs>0&&<div style={{ position:"absolute", top:0, right:0, background:"#FA3E3E", borderRadius:"50%", width:14, height:14, fontSize:9, display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontWeight:900, border:"2px solid #fff" }}>{unreadNotifs}</div>}
                    </button>
                    <div onClick={()=>setTab("profile")} style={{ width:36, height:36, borderRadius:"50%", background:"#00B894", display:"flex", alignItems:"center", justifyContent:"center", fontSize:15, color:"#fff", fontWeight:800, cursor:"pointer", flexShrink:0 }}>
                      {(user.user_metadata?.name||"L")[0].toUpperCase()}
                    </div>
                  </>
                ) : (
                  <>
                    <button onClick={()=>{ setAuthModalMode("login"); setShowAuthModal(true); }} style={{ background:"#F0F2F5", border:"none", borderRadius:20, padding:"0 14px", height:34, fontSize:13, fontWeight:700, cursor:"pointer", color:"#1C1E21", fontFamily:"inherit" }}>Log in</button>
                    <button onClick={()=>{ setAuthModalMode("signup"); setShowAuthModal(true); }} style={{ background:"#00B894", border:"none", borderRadius:20, padding:"0 14px", height:34, fontSize:13, fontWeight:700, cursor:"pointer", color:"#fff", fontFamily:"inherit" }}>Sign up</button>
                  </>
                )}
              </div>
            </div>
            <div style={{ padding:"0 14px 8px" }}>
              <div style={{ background:"#F0F2F5", borderRadius:50, display:"flex", alignItems:"center", padding:"9px 14px", gap:8 }}>
                <span style={{ color:"#65676B", fontSize:15 }}>🔍</span>
                <input style={{ flex:1, background:"none", border:"none", outline:"none", color:"#1C1E21", fontSize:14, fontFamily:"inherit" }} placeholder="Search Lendie — borrow, rent, buy nearby" value={search} autoComplete="off" autoCorrect="off" spellCheck="false" onClick={e=>e.stopPropagation()} onChange={e=>{ e.stopPropagation(); setSearch(e.target.value); }}/>
                {search&&<span onClick={()=>setSearch("")} style={{ cursor:"pointer", color:"#65676B", fontSize:14 }}>x</span>}
              </div>
            </div>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0 14px 8px" }}>
              <div style={{ display:"flex", alignItems:"center", gap:5, cursor:"pointer" }} onClick={()=>setShowLocationPicker(p=>!p)}>
                <span style={{ fontSize:13, color:"#00B894" }}>📍</span>
                <span style={{ fontSize:13, fontWeight:600, color:"#00B894" }}>{locationText.split(",")[0]}</span>
                <span style={{ fontSize:12, color:"#65676B" }}>&middot; {radius}mi</span>
                <span style={{ fontSize:11, color:"#65676B" }}>{showLocationPicker?"▲":"▼"}</span>
              </div>
              <div style={{ display:"flex", gap:6 }}>
                <button onClick={()=>setViewMode("grid")} style={{ background:viewMode==="grid"?"#E8FBF6":"#F0F2F5", border:"none", borderRadius:8, padding:"6px 12px", fontSize:12, fontWeight:viewMode==="grid"?700:500, color:viewMode==="grid"?"#00B894":"#65676B", cursor:"pointer" }}>Grid</button>
                <button onClick={()=>setSortBy(s=>s==="distance"?"price":s==="price"?"rating":"distance")} style={{ background:"#F0F2F5", border:"none", borderRadius:8, padding:"6px 12px", fontSize:12, fontWeight:500, color:"#65676B", cursor:"pointer" }}>Sort: {sortBy}</button>
              </div>
            </div>
            <div style={{ display:"flex", borderTop:"1px solid #E4E6EB", overflowX:"auto", overflowY:"hidden", scrollbarWidth:"none", height:44, alignItems:"stretch", WebkitOverflowScrolling:"touch" }}>
              {TABS.map(([id,label])=>(
                <button key={id} onClick={()=>setCategory(id)} style={{ background:"transparent", border:"none", borderBottom:category===id?"3px solid #00B894":"3px solid transparent", height:44, padding:"0 14px", fontSize:13, fontWeight:category===id?700:500, color:category===id?"#00B894":"#65676B", cursor:"pointer", whiteSpace:"nowrap", flexShrink:0, boxSizing:"border-box" }}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          {showLocationPicker && (
            <div style={{ background:"#fff", borderBottom:"1px solid #E4E6EB", padding:"14px" }}>
              <div style={{ display:"flex", gap:8, marginBottom:10 }}>
                <div style={{ flex:1, background:"#F0F2F5", borderRadius:8, display:"flex", alignItems:"center", padding:"10px 12px", gap:8 }}>
                  <span style={{ fontSize:14 }}>📍</span>
                  <input style={{ flex:1, background:"none", border:"none", outline:"none", color:"#1C1E21", fontSize:13, fontFamily:"inherit" }} placeholder="City or address..." value={locationText==="Current Location"?"":locationText} onChange={e=>setLocationText(e.target.value||"Current Location")}/>
                </div>
                <button onClick={()=>setLocationText("Current Location")} style={{ background:"#E8FBF6", border:"none", borderRadius:8, padding:"0 12px", color:"#00B894", fontSize:12, fontWeight:700, cursor:"pointer" }}>Use mine</button>
              </div>
              <div style={{ display:"flex", gap:6, marginBottom:12, flexWrap:"wrap" }}>
                {["Current Location","Downtown","Brooklyn, NY","Hoboken"].map(loc=>(
                  <button key={loc} onClick={()=>setLocationText(loc)} style={{ background:locationText===loc?"#E8FBF6":"#F0F2F5", border:locationText===loc?"1px solid #00B894":"1px solid #E4E6EB", borderRadius:20, padding:"5px 12px", fontSize:12, fontWeight:locationText===loc?700:500, color:locationText===loc?"#00B894":"#65676B", cursor:"pointer" }}>
                    {loc}
                  </button>
                ))}
              </div>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}>
                <span style={{ fontSize:12, fontWeight:700, color:"#65676B" }}>Radius</span>
                <span style={{ fontSize:13, fontWeight:800, color:"#00B894" }}>{radius}mi</span>
              </div>
              <div style={{ display:"flex", gap:6, marginBottom:12 }}>
                {[1,2,5,10,20,25].map(r=>(
                  <button key={r} onClick={()=>setRadius(r)} style={{ background:radius===r?"#00B894":"#F0F2F5", border:"none", borderRadius:20, padding:"5px 0", fontSize:12, fontWeight:radius===r?700:500, color:radius===r?"#fff":"#65676B", cursor:"pointer", flex:1 }}>{r}mi</button>
                ))}
              </div>
              <div style={{ display:"flex", justifyContent:"space-between", borderTop:"1px solid #E4E6EB", paddingTop:12 }}>
                <div style={{ fontSize:12, color:"#65676B" }}><span style={{ fontWeight:700, color:"#1C1E21" }}>{filtered.length}</span> listings</div>
                <button onClick={()=>setShowLocationPicker(false)} style={{ background:"#00B894", border:"none", borderRadius:8, padding:"8px 18px", color:"#fff", fontSize:13, fontWeight:700, cursor:"pointer" }}>Done</button>
              </div>
            </div>
          )}
          <div style={{ background:"#fff", padding:"12px 14px 8px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <div style={{ fontSize:18, fontWeight:800, color:"#1C1E21" }}>Near you</div>
            <div style={{ fontSize:13, color:"#00B894", fontWeight:600, cursor:"pointer" }} onClick={()=>setShowLocationPicker(p=>!p)}>{locationText.split(",")[0]}, {radius}mi</div>
          </div>
          {filtered.length===0
            ? <div style={{ textAlign:"center", padding:"50px 20px", color:"#65676B" }}>No listings found</div>
            : <CardGrid/>}
        </div>
      )}

      {tab==="listings" && (
        <div>
          <div style={{ background:"#fff", padding:"14px 16px 12px", borderBottom:"1px solid #E4E6EB", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <div style={{ fontSize:22, fontWeight:900, color:"#00B894" }}>My Listings</div>
            <button onClick={()=>{ if (requireAuth()) setShowAddListing(true); }} style={{ background:"#00B894", border:"none", borderRadius:8, padding:"8px 14px", color:"#fff", fontSize:13, fontWeight:700, cursor:"pointer" }}>+ List item</button>
          </div>
          {!user && (
            <div style={{ textAlign:"center", padding:"60px 24px 40px" }}>
              <div style={{ fontSize:48, marginBottom:16 }}>📦</div>
              <div style={{ fontSize:17, fontWeight:800, color:"#1C1E21", marginBottom:8 }}>List your first item</div>
              <div style={{ fontSize:13, color:"#65676B", marginBottom:24, lineHeight:1.6 }}>Sign in to earn money by renting out tools, gear, and more to your neighbors.</div>
              <button onClick={()=>{ setAuthModalMode("signup"); setShowAuthModal(true); }} style={{ width:"100%", padding:"14px", borderRadius:12, border:"none", fontFamily:"inherit", fontWeight:700, fontSize:15, cursor:"pointer", background:"#00B894", color:"#fff", marginBottom:10 }}>Get started</button>
              <button onClick={()=>{ setAuthModalMode("login"); setShowAuthModal(true); }} style={{ width:"100%", padding:"13px", borderRadius:12, border:"1px solid #CDD0D4", fontFamily:"inherit", fontWeight:600, fontSize:14, cursor:"pointer", background:"#fff", color:"#1C1E21" }}>Sign in</button>
            </div>
          )}
          {user && myListings.length===0 && <div style={{ textAlign:"center", padding:"50px 20px", color:"#65676B" }}>No listings yet. Tap + to add one!</div>}
          {user && myListings.map(l=>(
            <div key={l.id} style={{ background:"#fff", margin:"0 0 2px", padding:"14px 16px", borderBottom:"1px solid #F0F2F5" }}>
              <div style={{ display:"flex", gap:12, alignItems:"center" }}>
                <div style={{ width:60, height:60, borderRadius:10, background:(l.color||"#eee")+"20", display:"flex", alignItems:"center", justifyContent:"center", fontSize:28, flexShrink:0 }}>
                  {l.uploadedImages&&l.uploadedImages[0] ? <img src={l.uploadedImages[0].url} alt="" style={{ width:60, height:60, borderRadius:10, objectFit:"cover" }}/> : l.emoji}
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:700, fontSize:14, color:"#1C1E21" }}>{l.title}</div>
                  <div style={{ fontSize:12, color:"#65676B" }}>${l.price}/{l.priceUnit||"day"} &middot; {l.views||0} views &middot; {l.requests||0} requests</div>
                  <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:4 }}>
                    <div style={{ width:8, height:8, borderRadius:"50%", background:l.available?"#31A24C":"#FA3E3E" }}/>
                    <span style={{ fontSize:11, color:l.available?"#31A24C":"#FA3E3E", fontWeight:600 }}>{l.available?"Live":"Paused"}</span>
                  </div>
                </div>
                <div style={{ display:"flex", gap:6 }}>
                  <button onClick={async()=>{ const next=!l.available; const{error}=await supabase.from('listings').update({available:next}).eq('id',l.id); if(!error)setMyListings(prev=>prev.map(x=>x.id===l.id?{...x,available:next}:x)); }} style={{ background:"#F0F2F5", border:"none", borderRadius:8, padding:"6px 10px", fontSize:11, fontWeight:700, cursor:"pointer", color:"#65676B" }}>{l.available?"Pause":"Resume"}</button>
                  <button onClick={()=>setDeletingId(l.id)} style={{ background:"#FFF0F0", border:"none", borderRadius:8, padding:"6px 10px", fontSize:11, fontWeight:700, cursor:"pointer", color:"#FA3E3E" }}>Delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab==="messages" && !activeConvo && (
        <div>
          <div style={{ background:"#fff", padding:"14px 16px 12px", borderBottom:"1px solid #E4E6EB" }}>
            <div style={{ fontSize:22, fontWeight:900, color:"#00B894" }}>Messages</div>
          </div>
          {!user && (
            <div style={{ textAlign:"center", padding:"60px 24px 40px" }}>
              <div style={{ fontSize:48, marginBottom:16 }}>💬</div>
              <div style={{ fontSize:17, fontWeight:800, color:"#1C1E21", marginBottom:8 }}>Your inbox</div>
              <div style={{ fontSize:13, color:"#65676B", marginBottom:24, lineHeight:1.6 }}>Sign in to message owners and manage your bookings.</div>
              <button onClick={()=>{ setAuthModalMode("login"); setShowAuthModal(true); }} style={{ width:"100%", padding:"14px", borderRadius:12, border:"none", fontFamily:"inherit", fontWeight:700, fontSize:15, cursor:"pointer", background:"#00B894", color:"#fff" }}>Sign in</button>
            </div>
          )}
          {user && messages.length===0 && <div style={{ textAlign:"center", padding:"50px 20px", color:"#65676B" }}>No messages yet</div>}
          {user && messages.map(m=>(
            <div key={m.id} onClick={()=>{ setActiveConvo(m); setMessages(prev=>prev.map(x=>x.id===m.id?{...x,unread:false}:x)); }} style={{ background:"#fff", padding:"14px 16px", borderBottom:"1px solid #F0F2F5", display:"flex", gap:12, cursor:"pointer", alignItems:"center" }}>
              <div style={{ width:50, height:50, borderRadius:"50%", background:"#E8FBF6", display:"flex", alignItems:"center", justifyContent:"center", fontSize:26, flexShrink:0 }}>{m.avatar}</div>
              <div style={{ flex:1 }}>
                <div style={{ fontWeight:m.unread?700:500, fontSize:14, color:"#1C1E21" }}>{m.from}</div>
                <div style={{ fontSize:12, color:"#65676B" }}>{m.item}</div>
                <div style={{ fontSize:11, color:"#8A8D91" }}>{m.time}</div>
              </div>
              {m.unread && <div style={{ width:10, height:10, borderRadius:"50%", background:"#00B894", flexShrink:0 }}/>}
            </div>
          ))}
        </div>
      )}

      {tab==="profile" && (
        <div>
          <div style={{ background:"#fff", padding:"14px 16px 12px", borderBottom:"1px solid #E4E6EB" }}>
            <div style={{ fontSize:22, fontWeight:900, color:"#00B894" }}>Profile</div>
          </div>
          {!user && (
            <div style={{ textAlign:"center", padding:"60px 24px 40px" }}>
              <div style={{ width:80, height:80, borderRadius:"50%", background:"#E8FBF6", display:"flex", alignItems:"center", justifyContent:"center", fontSize:36, margin:"0 auto 16px" }}>👤</div>
              <div style={{ fontSize:18, fontWeight:800, color:"#1C1E21", marginBottom:8 }}>Join Lendie</div>
              <div style={{ fontSize:13, color:"#65676B", marginBottom:28, lineHeight:1.6 }}>Sign up to list items, save favorites, and connect with neighbors.</div>
              <button onClick={()=>{ setAuthModalMode("signup"); setShowAuthModal(true); }} style={{ width:"100%", padding:"14px", borderRadius:12, border:"none", fontFamily:"inherit", fontWeight:700, fontSize:15, cursor:"pointer", background:"#00B894", color:"#fff", marginBottom:10 }}>Create account</button>
              <button onClick={()=>{ setAuthModalMode("login"); setShowAuthModal(true); }} style={{ width:"100%", padding:"13px", borderRadius:12, border:"1px solid #CDD0D4", fontFamily:"inherit", fontWeight:600, fontSize:14, cursor:"pointer", background:"#fff", color:"#1C1E21" }}>Sign in</button>
            </div>
          )}
          {user && (
            <>
              <div style={{ background:"#fff", padding:"32px 16px 24px", textAlign:"center", borderBottom:"1px solid #E4E6EB" }}>
                <div style={{ width:80, height:80, borderRadius:"50%", background:"#00B894", display:"flex", alignItems:"center", justifyContent:"center", fontSize:32, margin:"0 auto 14px", color:"#fff", fontWeight:800, flexShrink:0 }}>
                  {(user.user_metadata?.name||"L")[0].toUpperCase()}
                </div>
                <div style={{ fontSize:20, fontWeight:800, color:"#1C1E21" }}>{user.user_metadata?.name || "Lendie User"}</div>
                <div style={{ fontSize:13, color:"#65676B", marginTop:4 }}>{user.email}</div>
              </div>
              <div style={{ display:"flex", gap:12, padding:16 }}>
                {[["Listings",myListings.length],["Saved",favorites.length],["Messages",messages.length]].map(([label,val])=>(
                  <div key={label} style={{ flex:1, background:"#F0F2F5", borderRadius:12, padding:"12px 8px", textAlign:"center" }}>
                    <div style={{ fontSize:22, fontWeight:800, color:"#00B894" }}>{val}</div>
                    <div style={{ fontSize:11, color:"#65676B", marginTop:2 }}>{label}</div>
                  </div>
                ))}
              </div>
              {myListings.length > 0 && (
                <div style={{ padding:"0 16px 16px" }}>
                  <div style={{ fontSize:15, fontWeight:800, color:"#1C1E21", marginBottom:12 }}>My Listings</div>
                  {myListings.map(l => (
                    <div key={l.id} onClick={()=>{ setSelectedItem({...l,owner:user.user_metadata?.name||"You",ownerAvatar:"🧑",ownerId:"me",distance:0,lat:40.714,lng:-74.006}); setTab("browse"); }} style={{ display:"flex", gap:12, background:"#F7F8FA", borderRadius:12, border:"1px solid #E4E6EB", padding:"12px 14px", marginBottom:10, cursor:"pointer", alignItems:"center" }}>
                      <div style={{ width:48, height:48, borderRadius:10, background:(l.color||"#eee")+"15", display:"flex", alignItems:"center", justifyContent:"center", fontSize:24, flexShrink:0, overflow:"hidden" }}>
                        {l.uploadedImages?.[0] ? <img src={l.uploadedImages[0].url} alt="" style={{ width:48, height:48, objectFit:"cover" }}/> : l.emoji}
                      </div>
                      <div style={{ flex:1 }}>
                        <div style={{ fontWeight:600, fontSize:13, color:"#1C1E21" }}>{l.title}</div>
                        <div style={{ fontSize:11, color:"#65676B" }}>${l.price}/{l.priceUnit||"day"}</div>
                      </div>
                      <div style={{ width:8, height:8, borderRadius:"50%", background:l.available?"#31A24C":"#FA3E3E", flexShrink:0 }}/>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ padding:"0 16px 40px" }}>
                <button onClick={async()=>{ await supabase.auth.signOut(); }} style={{ width:"100%", padding:"14px", borderRadius:12, border:"1.5px solid #FA3E3E", fontFamily:"inherit", fontWeight:700, fontSize:15, cursor:"pointer", background:"#FFF0F0", color:"#FA3E3E" }}>
                  Sign Out
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <ItemDetailSheet
        item={selectedItem}
        requestSent={requestSent}
        favorites={favorites}
        toggleFav={toggleFav}
        allItems={allItems}
        OWNERS={OWNERS}
        setOwnerProfileId={setOwnerProfileId}
        setPhotoBrowser={setPhotoBrowser}
        onDismiss={()=>setSelectedItem(null)}
        setPaymentModal={setPaymentModal}
        setPaymentStep={setPaymentStep}
        onConfirmBooking={(s,e)=>{
          if (!s) return;
          if (!requireAuth()) return;
          setPaymentModal({ item:selectedItem, start:s, end:e||s });
          setPaymentStep(1);
        }}
      />
      <PaymentModal/>
      <AddListingModal
        show={showAddListing}
        onClose={()=>{ setShowAddListing(false); setAddImages([]); }}
        newListing={newListing}
        setNewListing={setNewListing}
        addImages={addImages}
        setAddImages={setAddImages}
        onSubmit={handleAddListing}
        S={S}
        C={C}
        ALL_CATS={ALL_CATS}
      />
      <NotifPanel/>
      <ChatView
        activeConvo={activeConvo}
        setActiveConvo={setActiveConvo}
        chatMsg={chatMsg}
        setChatMsg={setChatMsg}
        messages={messages}
        setMessages={setMessages}
        msgEndRef={msgEndRef}
      />
      <OwnerProfileModal
        ownerId={ownerProfileId}
        allItems={allItems}
        onClose={()=>setOwnerProfileId(null)}
        onSelectItem={item=>{ setSelectedItem(item); setOwnerProfileId(null); }}
        onMessage={owner=>{
          if (!requireAuth()) return;
          setOwnerProfileId(null);
          const ex = messages.find(m=>m.fromId===owner.id);
          if (ex) { setActiveConvo(ex); }
          else {
            const nm = { id:Date.now(), from:owner.name, fromId:owner.id, avatar:owner.avatar, item:"General inquiry", time:"Just now", unread:false, thread:[] };
            setMessages(prev=>[...prev,nm]); setActiveConvo(nm);
          }
          setTab("messages");
        }}
      />
      <PhotoBrowserModal data={photoBrowser} onClose={()=>setPhotoBrowser(null)}/>
      {deletingId && (
        <div style={S.overlay} onClick={()=>setDeletingId(null)}>
          <div style={{ ...S.sheet, maxHeight:"auto" }} onClick={e=>e.stopPropagation()}>
            <div style={{ fontSize:16, fontWeight:700, color:"#1C1E21", marginBottom:8 }}>Delete listing?</div>
            <div style={{ fontSize:13, color:"#65676B", marginBottom:20 }}>This cannot be undone.</div>
            <button style={{ ...S.pBtn, background:"#FA3E3E" }} onClick={async()=>{ const{error}=await supabase.from('listings').delete().eq('id',deletingId); if(!error){setMyListings(prev=>prev.filter(l=>l.id!==deletingId));setDeletingId(null);showToast("Listing deleted");}else{showToast("Failed to delete","error");} }}>Delete</button>
            <button style={S.gBtn} onClick={()=>setDeletingId(null)}>Cancel</button>
          </div>
        </div>
      )}
      <AuthModal show={showAuthModal} initialMode={authModalMode} onClose={()=>setShowAuthModal(false)}/>
      <Toast toast={toast}/>
      <nav style={S.nav}>
        {[
          {id:"browse", icon:"🏠", label:"Browse"},
          {id:"listings", icon:"📦", label:"My Items"},
          {id:"messages", icon:"💬", label:"Inbox", badge:unreadMsgs},
          {id:"profile", icon:"👤", label:"Profile"},
        ].map(n=>(
          <div key={n.id} onClick={()=>{ setTab(n.id); if(activeConvo&&n.id!=="messages") setActiveConvo(null); }} style={{ flex:1, padding:"10px 0 8px", display:"flex", flexDirection:"column", alignItems:"center", gap:3, cursor:"pointer", color:tab===n.id?"#00B894":"#65676B", fontSize:9, fontWeight:tab===n.id?700:500, position:"relative" }}>
            <span style={{ fontSize:22 }}>{n.icon}</span>
            {n.label}
            {n.badge>0 && <div style={{ position:"absolute", top:5, right:"16%", background:"#FA3E3E", borderRadius:"50%", width:14, height:14, fontSize:9, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:900, color:"#fff" }}>{n.badge}</div>}
          </div>
        ))}
      </nav>
    </div>
  );
}