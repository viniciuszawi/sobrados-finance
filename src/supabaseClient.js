import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://cuklslepdlottxsenkjh.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN1a2xzbGVwZGxvdHR4c2Vua2poIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyNTQyODksImV4cCI6MjA4ODgzMDI4OX0.YVrDj20IYXcVEn32svrH46hpzObEhnA0wXiE676LtCM'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
